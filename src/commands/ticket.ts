import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';

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

  // Check if user already has a ticket
  const existingChannel = guild.channels.cache.find((channel: any) => 
    channel.name === `ticket-${user.username.toLowerCase()}`
  );

  if (existingChannel) {
    await interaction.reply({ content: 'Du hast bereits ein offenes Ticket!', ephemeral: true });
    return;
  }

  // Create ticket channel
  const ticketChannel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: 0, // Text channel
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

  // Save ticket to database
  try {
    const { dbManager } = await import('../database/database.js');
    await dbManager.createTicket({
      userId: user.id,
      username: user.username,
      reason,
      channelId: ticketChannel.id,
      guildId: guild.id
    });

    // Send webhook notification
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
  } catch (error) {
    console.error('Error saving ticket to database:', error);
  }

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
  await interaction.reply({ content: `Ticket erstellt: ${ticketChannel}`, ephemeral: true });
}

async function closeTicket(interaction: any) {
  const channel = interaction.channel;
  
  if (!channel.name.startsWith('ticket-')) {
    await interaction.reply({ content: 'Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🔒 Ticket wird geschlossen')
    .setDescription('Dieser Kanal wird in 5 Sekunden gelöscht.')
    .setColor(0xFF0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  setTimeout(async () => {
    await channel.delete();
  }, 5000);
}

async function setupTicketSystem(interaction: any) {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket System')
    .setDescription('Klicke auf den Button unten, um ein neues Ticket zu erstellen.')
    .setColor(0x00AE86)
    .setTimestamp();

  const createButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket_button')
        .setLabel('Ticket erstellen')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫')
    );

  await interaction.reply({ embeds: [embed], components: [createButton] });
}
