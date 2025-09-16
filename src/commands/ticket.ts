import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { featureManager } from '../features/featureManager.js';
import { dbManager } from '../database/database.js';

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
      await createTicketWithCategories(interaction);
      break;
    case 'close':
      await closeTicket(interaction);
      break;
    case 'setup':
      await setupTicketSystem(interaction);
      break;
  }
}

async function createTicketWithCategories(interaction: any) {
  const reason = interaction.options.getString('reason');
  const guild = interaction.guild;
  const user = interaction.user;

  // Defer reply to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get available categories for this guild
    const categories = await dbManager.getTicketCategories(guild.id, true); // Only active categories

    if (categories.length === 0) {
      // No categories available, create ticket without category
      await createTicket(interaction, reason, null);
      return;
    }

    // If only one category exists, use it directly
    if (categories.length === 1) {
      await createTicket(interaction, reason, categories[0]);
      return;
    }

    // Multiple categories available - show selection menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Wähle eine Ticket-Kategorie aus...');

    // Add categories to select menu
    categories.forEach(category => {
      const emoji = category.emoji || '📝';
      const label = category.name;
      const description = category.description || 'Keine Beschreibung verfügbar';
      
      selectMenu.addOptions([{
        label: label,
        description: description.length > 100 ? description.substring(0, 97) + '...' : description,
        value: category.id.toString(),
        emoji: emoji
      }]);
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket erstellen')
      .setDescription(`**Grund:** ${reason}\n\nBitte wähle eine passende Kategorie für dein Ticket aus:`)
      .setColor(0x5865F2)
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Store the reason in a temporary way (you might want to use a database or cache for this)
    // For now, we'll handle this in the interaction handler
    
  } catch (error) {
    console.error('Error showing ticket categories:', error);
    await interaction.editReply({
      content: '❌ Fehler beim Laden der Ticket-Kategorien. Erstelle Ticket ohne Kategorie...'
    });
    
    // Fallback: create ticket without category
    await createTicket(interaction, reason, null);
  }
}

async function createTicket(interaction: any, reason: string, category: any = null) {
  const guild = interaction.guild;
  const user = interaction.user;

  // Generate unique ticket channel name
  const timestamp = Date.now();
  const shortId = timestamp.toString().slice(-6);
  const categoryPrefix = category ? `${category.name.toLowerCase().replace(/\s+/g, '-')}-` : '';
  const ticketChannelName = `ticket-${categoryPrefix}${user.username.toLowerCase()}-${shortId}`;

  try {
    // Create ticket channel
    const ticketChannel = await guild.channels.create({
      name: ticketChannelName,
      type: 0, // Text channel
      topic: `🎫 ${reason} | Erstellt von ${user.tag} ${category ? `| ${category.name}` : ''}`,
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

    // Save to database with category
    const ticketId = await dbManager.createTicket({
      userId: user.id,
      username: user.username,
      reason,
      channelId: ticketChannel.id,
      guildId: guild.id,
      categoryId: category ? category.id : null
    });

    // Create welcome embed
    const welcomeEmbed = new EmbedBuilder()
      .setTitle('🎫 Neues Ticket erstellt')
      .setDescription(`Willkommen **${user.username}**!\n\n**Grund:** ${reason}`)
      .setColor(category ? parseInt(category.color.replace('#', ''), 16) : 0x5865F2)
      .addFields([
        {
          name: 'Ticket ID',
          value: `#${ticketId}`,
          inline: true
        },
        {
          name: 'Kategorie',
          value: category ? `${category.emoji || '📝'} ${category.name}` : 'Keine Kategorie',
          inline: true
        },
        {
          name: 'Status',
          value: '🟢 Offen',
          inline: true
        }
      ])
      .setTimestamp()
      .setFooter({ text: `Erstellt von ${user.username}`, iconURL: user.displayAvatarURL() });

    // Add category description if available
    if (category && category.description) {
      welcomeEmbed.addFields([{
        name: 'Kategorie-Beschreibung',
        value: category.description
      }]);
    }

    // Close button
    const closeButton = new ButtonBuilder()
      .setCustomId(`close_ticket_${ticketId}`)
      .setLabel('Ticket schließen')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const actionRow = new ActionRowBuilder().addComponents(closeButton);

    // Send welcome message to ticket channel
    await ticketChannel.send({
      content: `<@${user.id}>`,
      embeds: [welcomeEmbed],
      components: [actionRow]
    });

    // Update the original interaction
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Ticket erstellt')
      .setDescription(`Dein Ticket wurde erfolgreich erstellt: <#${ticketChannel.id}>`)
      .setColor(0x57F287);

    await interaction.editReply({
      embeds: [successEmbed],
      components: []
    });

    console.log(`✅ Ticket created: ${ticketChannelName} by ${user.username} in guild ${guild.name}`);

  } catch (error) {
    console.error('Error creating ticket:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Fehler')
      .setDescription('Es gab einen Fehler beim Erstellen des Tickets. Bitte versuche es später erneut.')
      .setColor(0xED4245);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: []
    });
  }
}

async function closeTicket(interaction: any) {
  const channel = interaction.channel;
  const user = interaction.user;

  // Check if this is a ticket channel
  if (!channel.name.startsWith('ticket-')) {
    await interaction.reply({
      content: '❌ Dieser Befehl kann nur in Ticket-Kanälen verwendet werden.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Generate transcript
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = generateTranscript(messages);

    // Find ticket in database by channel ID
    const tickets = await dbManager.getTickets(interaction.guild.id);
    const ticket = tickets.find((t: any) => t.channel_id === channel.id);

    if (ticket) {
      // Save transcript and close ticket
      await dbManager.saveTicketTranscript(ticket.id, transcript);
      await dbManager.closeTicket(ticket.id);
    }

    // Create closing embed
    const closeEmbed = new EmbedBuilder()
      .setTitle('🔒 Ticket geschlossen')
      .setDescription(`Ticket wurde von **${user.username}** geschlossen.`)
      .setColor(0xED4245)
      .setTimestamp();

    await interaction.editReply({
      embeds: [closeEmbed]
    });

    // Delete channel after 10 seconds
    setTimeout(async () => {
      try {
        await channel.delete();
      } catch (error) {
        console.error('Error deleting ticket channel:', error);
      }
    }, 10000);

    console.log(`✅ Ticket closed: ${channel.name} by ${user.username} in guild ${interaction.guild.name}`);

  } catch (error) {
    console.error('Error closing ticket:', error);
    await interaction.editReply({
      content: '❌ Fehler beim Schließen des Tickets.'
    });
  }
}

async function setupTicketSystem(interaction: any) {
  await interaction.deferReply();

  try {
    // Get available categories
    const categories = await dbManager.getTicketCategories(interaction.guild.id, true);

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket System')
      .setDescription('Wähle eine Kategorie aus, um ein neues Ticket zu erstellen:')
      .setColor(0x5865F2)
      .setTimestamp();

    if (categories.length === 0) {
      embed.setDescription('⚠️ Keine Ticket-Kategorien verfügbar. Bitte erstelle zuerst Kategorien im Dashboard.');
      
      await interaction.editReply({
        embeds: [embed]
      });
      return;
    }

    // Create buttons for each category (max 25 components)
    const components = [];
    const buttons = [];

    for (let i = 0; i < Math.min(categories.length, 20); i++) { // Max 20 categories (4 rows of 5)
      const category = categories[i];
      
      const button = new ButtonBuilder()
        .setCustomId(`create_ticket_${category.id}`)
        .setLabel(category.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(category.emoji || '📝');

      buttons.push(button);

      // Create new row every 5 buttons
      if (buttons.length === 5 || i === categories.length - 1) {
        components.push(new ActionRowBuilder().addComponents(buttons));
        buttons.length = 0; // Clear array
      }
    }

    await interaction.editReply({
      embeds: [embed],
      components
    });

  } catch (error) {
    console.error('Error setting up ticket system:', error);
    await interaction.editReply({
      content: '❌ Fehler beim Einrichten des Ticket-Systems.'
    });
  }
}

function generateTranscript(messages: any) {
  const transcript = {
    channel: messages.first()?.channel?.name || 'Unknown',
    messages: messages.map((msg: any) => ({
      id: msg.id,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        discriminator: msg.author.discriminator,
        avatar: msg.author.avatar
      },
      content: msg.content,
      timestamp: msg.createdTimestamp,
      embeds: msg.embeds.map((embed: any) => ({
        title: embed.title,
        description: embed.description,
        color: embed.color,
        fields: embed.fields
      })),
      attachments: msg.attachments.map((att: any) => ({
        id: att.id,
        filename: att.name,
        url: att.url
      }))
    })).reverse() // Reverse to get chronological order
  };

  return JSON.stringify(transcript, null, 2);
}

// Export function for handling category selection
export async function handleCategorySelection(interaction: any) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket_category_select') {
    return;
  }

  const categoryId = parseInt(interaction.values[0]);
  const guild = interaction.guild;

  try {
    // Get the category from database
    const category = await dbManager.getTicketCategoryById(categoryId, guild.id);
    
    if (!category) {
      await interaction.reply({
        content: '❌ Kategorie nicht gefunden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Extract reason from the original embed description
    const originalEmbed = interaction.message.embeds[0];
    const description = originalEmbed.description;
    const reasonMatch = description.match(/\*\*Grund:\*\* (.+)/);
    const reason = reasonMatch ? reasonMatch[1] : 'Kein Grund angegeben';

    await interaction.deferUpdate();

    // Create the ticket with the selected category
    await createTicket(interaction, reason, category);

  } catch (error) {
    console.error('Error handling category selection:', error);
    await interaction.reply({
      content: '❌ Fehler bei der Kategorie-Auswahl.',
      flags: MessageFlags.Ephemeral
    });
  }
}

// Export function for handling ticket creation buttons
export async function handleTicketButton(interaction: any) {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;

  // Handle create ticket buttons from setup
  if (customId.startsWith('create_ticket_')) {
    const categoryId = parseInt(customId.split('_')[2]);
    
    // Show reason input modal
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');
    
    const modal = new ModalBuilder()
      .setCustomId(`ticket_reason_modal_${categoryId}`)
      .setTitle('Neues Ticket erstellen');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Grund für das Ticket')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Beschreibe dein Anliegen...')
      .setRequired(true)
      .setMaxLength(1000);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  }

  // Handle close ticket buttons
  if (customId.startsWith('close_ticket_')) {
    await closeTicket(interaction);
  }
}

// Export function for handling ticket reason modals
export async function handleTicketModal(interaction: any) {
  if (!interaction.isModalSubmit()) return;

  const customId = interaction.customId;

  if (customId.startsWith('ticket_reason_modal_')) {
    const categoryId = parseInt(customId.split('_')[3]);
    const reason = interaction.fields.getTextInputValue('reason');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Get the category from database
      const category = await dbManager.getTicketCategoryById(categoryId, interaction.guild.id);
      
      if (!category) {
        await interaction.editReply({
          content: '❌ Kategorie nicht gefunden.'
        });
        return;
      }

      // Create the ticket with the selected category and reason
      await createTicket(interaction, reason, category);

    } catch (error) {
      console.error('Error handling ticket modal:', error);
      await interaction.editReply({
        content: '❌ Fehler beim Erstellen des Tickets.'
      });
    }
  }
}

// Export function for category ticket creation (used in index.ts)
export async function createCategoryTicket(interaction: any, categoryId: string) {
  try {
    if (!interaction.guild) {
      await interaction.reply({
        content: '❌ Dieser Command kann nur in einem Server verwendet werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Get the category from database
    const category = await dbManager.getTicketCategoryById(parseInt(categoryId), interaction.guild.id);
    
    if (!category) {
      await interaction.reply({
        content: '❌ Kategorie nicht gefunden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Create modal for ticket details
    const modal = new ModalBuilder()
      .setCustomId(`create_ticket_modal_${categoryId}`)
      .setTitle(`Neues ${category.name} Ticket`);

    const subjectInput = new TextInputBuilder()
      .setCustomId('ticket_subject')
      .setLabel('Betreff')
      .setPlaceholder('Beschreibe kurz dein Anliegen...')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('ticket_description')
      .setLabel('Beschreibung')
      .setPlaceholder('Beschreibe dein Problem ausführlich...')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

    modal.addComponents(firstActionRow, secondActionRow);
    await interaction.showModal(modal);

  } catch (error) {
    console.error('Error creating category ticket:', error);
    await interaction.reply({
      content: '❌ Fehler beim Erstellen des Tickets.',
      flags: MessageFlags.Ephemeral
    });
  }
}
