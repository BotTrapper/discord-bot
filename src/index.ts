import { Client, GatewayIntentBits, REST, Routes, Collection, type Interaction } from 'discord.js';
import { AutoResponseFeature } from './features/autoResponse.js';
import { WebhookNotification } from './features/webhookNotification.js';
import { PermissionManager } from './features/permissionManager.js';
import { dbManager } from './database/database.js';
import { initializeDatabase, initializeGuildDefaults } from './database/migrations.js';
import { startApiServer } from './api/server.js';
import * as ticketCommand from './commands/ticket.js';
import * as embedCommand from './commands/embed.js';
import * as autoresponseCommand from './commands/autoresponse.js';
import * as webhookCommand from './commands/webhook.js';
import * as statsCommand from './commands/stats.js';
import 'dotenv/config';

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Commands collection
const commands = new Collection();
commands.set(ticketCommand.data.name, ticketCommand);
commands.set(embedCommand.data.name, embedCommand);
commands.set(autoresponseCommand.data.name, autoresponseCommand);
commands.set(webhookCommand.data.name, webhookCommand);
commands.set(statsCommand.data.name, statsCommand);

const TOKEN = process.env.DISCORD_TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const GUILD_ID = process.env.GUILD_ID || ''; // Optional: nur für Development/Testing

const commandsData = [
  ticketCommand.data.toJSON(),
  embedCommand.data.toJSON(),
  autoresponseCommand.data.toJSON(),
  webhookCommand.data.toJSON(),
  statsCommand.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    if (GUILD_ID) {
      // Development: Register commands für einen spezifischen Server (sofort verfügbar)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commandsData },
      );
      console.log('✅ Guild-specific slash commands registered.');
    } else {
      // Production: Register global commands (verfügbar auf allen Servern)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commandsData },
      );
      console.log('✅ Global slash commands registered for all servers.');
    }
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
}

// Initialize data from database for all guilds
async function initializeGuildData() {
  try {
    // Initialize database first
    await initializeDatabase();
    
    const guilds = client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      // Initialize default data for guild
      await initializeGuildDefaults(guildId);
      
      // Load webhooks from database into memory cache
      await WebhookNotification.loadWebhooks(guildId);
    }
    console.log('✅ Guild data initialized from database');
  } catch (error) {
    console.error('❌ Error initializing guild data:', error);
  }
}

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);
  
  // Start API server
  startApiServer();
  
  // Register commands
  await registerCommands();
  
  // Initialize guild data from database
  await initializeGuildData();
  
  console.log('🚀 Bot is fully ready!');
});

// Handle new guilds
client.on('guildCreate', async (guild) => {
  console.log(`🎉 Bot added to new guild: ${guild.name} (${guild.id})`);
  
  // Initialize default data for new guild
  await initializeGuildDefaults(guild.id);
  
  // Load webhooks from database
  await WebhookNotification.loadWebhooks(guild.id);
  
  console.log(`✅ Guild ${guild.name} initialized`);
});

// Handle slash commands
client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    // Check permissions (now async)
    const hasPermission = await PermissionManager.checkCommandPermission(interaction, interaction.commandName);
    if (!hasPermission) {
      await interaction.reply({ 
        content: '❌ Du hast keine Berechtigung für diesen Befehl!', 
        ephemeral: true 
      });
      return;
    }

    try {
      // Log command usage
      await dbManager.logCommand(
        interaction.commandName, 
        interaction.user.id, 
        interaction.guild?.id || 'DM'
      );

      await (command as any).execute(interaction);
    } catch (error) {
      console.error('Command execution error:', error);
      
      const reply = { content: '❌ Es gab einen Fehler beim Ausführen des Befehls!', ephemeral: true };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  }

  // Handle button interactions
  if (interaction.isButton()) {
    if (interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      
      if (!channel || !('name' in channel) || !channel.name?.startsWith('ticket-')) {
        await interaction.reply({ content: '❌ Dieser Button kann nur in Ticket-Kanälen verwendet werden!', ephemeral: true });
        return;
      }

      // Find ticket in database and close it
      try {
        const tickets = await dbManager.getTickets(interaction.guild!.id, 'open') as any[];
        const ticket = tickets.find(t => t.channel_id === channel.id);
        
        if (ticket) {
          await dbManager.closeTicket(ticket.id);
          
          // Send webhook notification
          try {
            await WebhookNotification.sendTicketNotification('tickets', {
              user: interaction.user.toString(),
              reason: ticket.reason,
              channelName: channel.name,
              action: 'closed'
            });
          } catch (webhookError) {
            console.log('Webhook notification failed:', webhookError);
          }
        }
      } catch (error) {
        console.error('Error closing ticket in database:', error);
      }

      await interaction.reply({ content: '🔒 Ticket wird in 5 Sekunden geschlossen...', ephemeral: true });
      
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (error) {
          console.error('Error deleting channel:', error);
        }
      }, 5000);
    }

    if (interaction.customId === 'create_ticket_button') {
      await interaction.reply({ 
        content: 'Verwende `/ticket create <grund>` um ein Ticket zu erstellen.', 
        ephemeral: true 
      });
    }
  }
});

// Handle automatic responses
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  try {
    // Get auto responses from database
    const responses = await dbManager.getAutoResponses(message.guild.id) as any[];
    const autoResponse = responses.find(r => 
      message.content.toLowerCase().includes(r.trigger_word.toLowerCase())
    );

    if (autoResponse) {
      if (autoResponse.is_embed) {
        const embed = AutoResponseFeature.createResponseEmbed({
          trigger: autoResponse.trigger_word,
          response: autoResponse.response_text,
          isEmbed: true,
          embedResponse: {
            title: autoResponse.embed_title || 'Automatische Antwort',
            description: autoResponse.embed_description || autoResponse.response_text,
            color: autoResponse.embed_color || 0x00AE86
          }
        });
        
        if (embed) {
          await message.reply({ embeds: [embed] });
        }
      } else {
        await message.reply(autoResponse.response_text);
      }
    }
  } catch (error) {
    console.error('Error handling auto response:', error);
  }
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Bot shutting down...');
  dbManager.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Bot shutting down...');
  dbManager.close();
  client.destroy();
  process.exit(0);
});

client.login(TOKEN);
