import type { ButtonInteraction, TextChannel } from "discord.js";
import { featureManager } from "../features/featureManager.js";
import { dbManager } from "../database/database.js";
import { generateChannelTranscript } from "../services/transcriptService.js";
import { TICKET_CLOSE_DELAY_MS } from "../config/constants.js";

/**
 * Handle close_ticket button interaction
 */
export async function handleCloseTicketButton(interaction: ButtonInteraction): Promise<void> {
  // Check if tickets feature is enabled for this guild
  const isTicketFeatureEnabled = await featureManager.isFeatureEnabled(
    interaction.guild!.id,
    "tickets",
  );
  if (!isTicketFeatureEnabled) {
    await interaction.reply({
      content:
        "⛔ Das Ticket-System ist für diesen Server deaktiviert.",
      flags: 64,
    });
    return;
  }

  const channel = interaction.channel as TextChannel | null;

  if (
    !channel ||
    !("name" in channel) ||
    !channel.name?.startsWith("ticket-")
  ) {
    await interaction.reply({
      content:
        "❌ Dieser Button kann nur in Ticket-Kanälen verwendet werden!",
      flags: 64,
    });
    return;
  }

  // Sofortiger Reply um Timeout zu vermeiden
  await interaction.deferReply({ flags: 64 });

  // Find ticket in database and close it
  try {
    const tickets = (await dbManager.getTickets(
      interaction.guild!.id,
      "open",
    )) as any[];
    const ticket = tickets.find((t) => t.channel_id === channel.id);

    if (ticket) {
      // Generate transcript BEFORE closing the ticket
      console.log(
        `🔄 Generating transcript for ticket ${ticket.id} in channel ${channel.name}...`,
      );
      try {
        const transcript = await generateChannelTranscript(channel);
        await dbManager.saveTicketTranscript(ticket.id, transcript);
        console.log(`✅ Transcript saved for ticket ${ticket.id}`);
      } catch (transcriptError) {
        console.error(
          "❌ Error generating/saving transcript:",
          transcriptError,
        );
        // Continue with closing even if transcript fails
      }

      await dbManager.closeTicket(ticket.id);
      console.log(`✅ Ticket ${ticket.id} closed successfully`);

      // Since Discord bot can write directly to channels, we don't need external webhooks
      console.log(
        `🎫 Ticket ${ticket.id} was closed by ${interaction.user.username}`,
      );
    } else {
      console.log(`⚠️ No open ticket found for channel ${channel.id}`);
    }
  } catch (error) {
    console.error("Error closing ticket in database:", error);
  }

  await interaction.editReply({
    content: `🔒 Ticket wird in ${TICKET_CLOSE_DELAY_MS / 1000} Sekunden geschlossen...`,
  });

  setTimeout(async () => {
    try {
      await channel.delete();
    } catch (error) {
      console.error("Error deleting channel:", error);
    }
  }, TICKET_CLOSE_DELAY_MS);
}

/**
 * Handle create_ticket_* button interaction (category ticket creation)
 */
export async function handleCreateTicketButton(interaction: ButtonInteraction, categoryId: string): Promise<void> {
  // Check if tickets feature is enabled for this guild
  const isTicketFeatureEnabled = await featureManager.isFeatureEnabled(
    interaction.guild!.id,
    "tickets",
  );
  if (!isTicketFeatureEnabled) {
    await interaction.reply({
      content:
        "⛔ Das Ticket-System ist für diesen Server deaktiviert.",
      flags: 64,
    });
    return;
  }

  // Import der createCategoryTicket Funktion
  const { createCategoryTicket } = await import("../commands/ticket.js");
  await createCategoryTicket(interaction, categoryId);
}

/**
 * Handle legacy create_ticket_button interaction
 */
export async function handleLegacyCreateTicketButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content:
      "Verwende das neue Ticket-System mit Kategorien! Führe `/ticket setup` aus.",
    flags: 64,
  });
}

/**
 * Main button handler that routes to specific handlers
 */
export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "close_ticket") {
    await handleCloseTicketButton(interaction);
    return;
  }

  // Kategorie-Ticket Button Handler
  if (interaction.customId?.startsWith("create_ticket_")) {
    const categoryId = interaction.customId.replace("create_ticket_", "");
    await handleCreateTicketButton(interaction, categoryId);
    return;
  }

  // Legacy Button (für Rückwärtskompatibilität)
  if (interaction.customId === "create_ticket_button") {
    await handleLegacyCreateTicketButton(interaction);
    return;
  }
}
