import {
  type ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { dbManager } from "../database/database.js";
import { hexToDiscordColor } from "../utils/colors.js";

/**
 * Handle create_ticket_modal_* submission
 */
export async function handleCreateTicketModal(
  interaction: ModalSubmitInteraction,
  categoryId: string,
): Promise<void> {
  const subject =
    interaction.fields.getTextInputValue("ticket_subject");
  const description =
    interaction.fields.getTextInputValue("ticket_description");

  try {
    // Get category from database
    const category = await dbManager.getTicketCategoryById(
      parseInt(categoryId),
      interaction.guild!.id,
    );

    if (!category) {
      await interaction.reply({
        content: "❌ Kategorie nicht gefunden.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer reply
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Generate unique ticket channel name
    const timestamp = Date.now();
    const shortId = timestamp.toString().slice(-6);
    const ticketChannelName = `ticket-${category.name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${interaction.user.username.toLowerCase()}-${shortId}`;

    // Create ticket channel
    const ticketChannel = await interaction.guild!.channels.create({
      name: ticketChannelName,
      type: 0, // Text channel
      topic: `${category.emoji || "🎫"} ${category.name} | Erstellt von ${interaction.user.tag}`,
      permissionOverwrites: [
        {
          id: interaction.guild!.roles.everyone.id,
          deny: ["ViewChannel"],
        },
        {
          id: interaction.user.id,
          allow: ["ViewChannel", "SendMessages"],
        },
      ],
    });

    // Save to database
    const ticketId = await dbManager.createTicket({
      userId: interaction.user.id,
      username: interaction.user.username,
      reason: `${subject}: ${description}`,
      channelId: ticketChannel.id,
      guildId: interaction.guild!.id,
      categoryId: category.id,
    });

    // Create welcome embed with correct color parsing
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`${category.emoji || "🎫"} ${category.name} Ticket`)
      .setDescription(
        `Willkommen ${interaction.user}! Dein Ticket wurde erstellt.`,
      )
      .setColor(hexToDiscordColor(category.color))
      .addFields([
        { name: "Ticket ID", value: `#${ticketId}`, inline: true },
        { name: "Kategorie", value: category.name, inline: true },
        { name: "Betreff", value: subject, inline: true },
        { name: "Beschreibung", value: description, inline: false },
        {
          name: "Erstellt von",
          value: interaction.user.tag,
          inline: true,
        },
      ])
      .setTimestamp()
      .setFooter({
        text: "Um das Ticket zu schließen, verwende den Button unten.",
      });

    // Create close button
    const closeButton =
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Ticket schließen")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🔒"),
      );

    await ticketChannel.send({
      embeds: [welcomeEmbed],
      components: [closeButton],
    });

    await interaction.editReply({
      content: `✅ Ticket erfolgreich erstellt! <#${ticketChannel.id}>`,
    });
  } catch (error) {
    console.error("Error creating ticket from modal:", error);
    await interaction.editReply({
      content:
        "❌ Fehler beim Erstellen des Tickets. Bitte versuche es erneut.",
    });
  }
}

/**
 * Main modal handler that routes to specific handlers
 */
export async function handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId?.startsWith("create_ticket_modal_")) {
    const categoryId = interaction.customId.replace(
      "create_ticket_modal_",
      "",
    );
    await handleCreateTicketModal(interaction, categoryId);
    return;
  }
}
