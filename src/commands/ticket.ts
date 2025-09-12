import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { featureManager } from '../features/featureManager.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket system commands')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new ticket')
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the ticket')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('close')
      .setDescription('Close the current ticket'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('setup')
      .setDescription('Setup ticket system'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction: any) {
  // Feature check - Block command if tickets are disabled
  const isTicketFeatureEnabled = await featureManager.isFeatureEnabled(interaction.guild.id, 'tickets');

  if (!isTicketFeatureEnabled) {
    return await interaction.reply({
      content: '⛔ Das Ticket-System ist für diesen Server deaktiviert.',
      flags: MessageFlags.Ephemeral
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await createTicket(interaction);
      break;
    case 'close':
      await closeTicket(interaction);
      break;
    case 'setup':
      await setupTicketSystem(interaction);
      break;
  }
}

async function createTicket(interaction: any) {
  const reason = interaction.options.getString('reason');
  const guild = interaction.guild;
  const user = interaction.user;

  // SOFORTIGER REPLY - Verhindert Interaction Timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Modern flags syntax

  // Generate unique ticket channel name
  const timestamp = Date.now();
  const ticketChannelName = `ticket-${user.username.toLowerCase()}-${timestamp}`;

  try {
    // Create ticket channel with unique name
    const ticketChannel = await guild.channels.create({
      name: ticketChannelName,
      type: 0, // Text channel
      topic: `🎫 ${reason} | Erstellt von ${user.tag}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    // Asynchrone Operationen nach Channel-Erstellung
    Promise.all([
      // Save to database
      (async () => {
        try {
          const { dbManager } = await import('../database/database.js');
          await dbManager.createTicket({
            userId: user.id,
            username: user.username,
            reason,
            channelId: ticketChannel.id,
            guildId: guild.id
          });
        } catch (error) {
          console.error('Error saving ticket to database:', error);
        }
      })(),
      
      // Send webhook notification
      (async () => {
        try {
          const { WebhookNotification } = await import('../features/webhookNotification.js');
          await WebhookNotification.sendTicketNotification('tickets', {
            user: user.toString(),
            reason,
            channelName: ticketChannel.name,
            action: 'created'
          });
        } catch (webhookError) {
          console.log('Webhook notification failed:', webhookError);
        }
      })()
    ]);

    const embed = new EmbedBuilder()
      .setTitle('🎫 Neues Ticket')
      .setDescription(`**Grund:** ${reason}\n**Erstellt von:** ${user}`)
      .setColor(0x00AE86)
      .setTimestamp();

    const closeButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Ticket schließen')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

    await ticketChannel.send({ embeds: [embed], components: [closeButton] });
    await interaction.editReply({ content: `Ticket erstellt: ${ticketChannel}` });

  } catch (error) {
    console.error('Error creating ticket:', error);
    await interaction.editReply({ content: '❌ Fehler beim Erstellen des Tickets!' });
  }
}

async function closeTicket(interaction: any) {
  const channel = interaction.channel;
  
  // Sofortiger Reply um Timeout zu vermeiden
  await interaction.deferReply();
  
  if (!channel.name.startsWith('ticket-')) {
    await interaction.editReply({ content: 'Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🔒 Ticket wird geschlossen')
    .setDescription('Dieser Kanal wird in 5 Sekunden gelöscht.')
    .setColor(0xFF0000)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  setTimeout(async () => {
    await channel.delete();
  }, 5000);
}

async function setupTicketSystem(interaction: any) {
  // Sofortiger Reply um Timeout zu vermeiden
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket System')
    .setDescription('Wähle eine Kategorie, um ein neues Ticket zu erstellen:')
    .addFields([
      { name: '🆘 Support', value: 'Allgemeine Hilfe und Fragen', inline: true },
      { name: '🐛 Bug Report', value: 'Fehler oder Probleme melden', inline: true },
      { name: '💡 Feature Request', value: 'Neue Funktionen vorschlagen', inline: true },
      { name: '⚙️ Administration', value: 'Server-Verwaltung', inline: true },
      { name: '❓ Sonstiges', value: 'Andere Anliegen', inline: true }
    ])
    .setColor(0x00AE86)
    .setTimestamp();

  // Erste Reihe: Support, Bug, Feature
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_support')
        .setLabel('Support')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🆘'),
      new ButtonBuilder()
        .setCustomId('ticket_bug')
        .setLabel('Bug Report')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🐛'),
      new ButtonBuilder()
        .setCustomId('ticket_feature')
        .setLabel('Feature Request')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💡')
    );

  // Zweite Reihe: Administration, Sonstiges
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_admin')
        .setLabel('Administration')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚙️'),
      new ButtonBuilder()
        .setCustomId('ticket_other')
        .setLabel('Sonstiges')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❓')
    );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// Neue Funktion: Kategorie-basierte Ticket-Erstellung
export async function createCategoryTicket(interaction: any, category: string) {
  const guild = interaction.guild;
  const user = interaction.user;

  // Sofortiger Reply um Timeout zu vermeiden
  await interaction.deferReply({ flags: 64 }); // ephemeral

  // Kategorie-Konfiguration
  const categories: Record<string, { name: string; emoji: string; color: number; description: string }> = {
    'support': { name: 'Support', emoji: '🆘', color: 0x3498db, description: 'Allgemeine Hilfe und Fragen' },
    'bug': { name: 'Bug Report', emoji: '🐛', color: 0xe74c3c, description: 'Fehler oder Probleme melden' },
    'feature': { name: 'Feature Request', emoji: '💡', color: 0x2ecc71, description: 'Neue Funktionen vorschlagen' },
    'admin': { name: 'Administration', emoji: '⚙️', color: 0x95a5a6, description: 'Server-Verwaltung' },
    'other': { name: 'Sonstiges', emoji: '❓', color: 0x9b59b6, description: 'Andere Anliegen' }
  };

  const categoryInfo = categories[category];
  if (!categoryInfo) {
    await interaction.editReply({ content: '❌ Ungültige Ticket-Kategorie!' });
    return;
  }

  // Generate unique ticket channel name with category and timestamp
  const timestamp = Date.now();
  const shortId = timestamp.toString().slice(-6); // Last 6 digits for readability
  const ticketChannelName = `ticket-${category}-${user.username.toLowerCase()}-${shortId}`;

  try {
    // Create ticket channel with unique name
    const ticketChannel = await guild.channels.create({
      name: ticketChannelName,
      type: 0, // Text channel
      topic: `${categoryInfo.emoji} ${categoryInfo.name} | Erstellt von ${user.tag}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    // Asynchrone Operationen nach Channel-Erstellung
    Promise.all([
      // Save to database
      (async () => {
        try {
          const { dbManager } = await import('../database/database.js');
          await dbManager.createTicket({
            userId: user.id,
            username: user.username,
            reason: categoryInfo.name,
            channelId: ticketChannel.id,
            guildId: guild.id
          });
        } catch (error) {
          console.error('Error saving ticket to database:', error);
        }
      })(),
      
      // Send webhook notification
      (async () => {
        try {
          const { WebhookNotification } = await import('../features/webhookNotification.js');
          await WebhookNotification.sendTicketNotification('tickets', {
            user: user.toString(),
            reason: categoryInfo.name,
            channelName: ticketChannel.name,
            action: 'created'
          });
        } catch (webhookError) {
          console.log('Webhook notification failed:', webhookError);
        }
      })()
    ]);

    const embed = new EmbedBuilder()
      .setTitle(`${categoryInfo.emoji} Neues ${categoryInfo.name} Ticket`)
      .setDescription(`**Kategorie:** ${categoryInfo.name}\n**Beschreibung:** ${categoryInfo.description}\n**Erstellt von:** ${user}`)
      .setColor(categoryInfo.color)
      .setTimestamp();

    const closeButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Ticket schließen')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

    await ticketChannel.send({ 
      content: `${user}, willkommen in deinem ${categoryInfo.name} Ticket! 🎫\n\nBitte beschreibe dein Anliegen so detailliert wie möglich.`,
      embeds: [embed], 
      components: [closeButton] 
    });
    
    await interaction.editReply({ content: `${categoryInfo.emoji} **${categoryInfo.name}** Ticket erstellt: ${ticketChannel}` });

  } catch (error) {
    console.error('Error creating category ticket:', error);
    await interaction.editReply({ content: '❌ Fehler beim Erstellen des Tickets!' });
  }
}
