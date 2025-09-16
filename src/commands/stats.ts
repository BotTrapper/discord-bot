import { SlashCommandBuilder } from "discord.js";
import { EmbedBuilderFeature } from "../features/embedBuilder.js";
import { dbManager } from "../database/database.js";
import { featureManager } from "../features/featureManager.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Bot Statistiken anzeigen")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("commands")
      .setDescription("Zeige Command-Nutzungsstatistiken")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Anzahl der Tage (Standard: 30)")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("tickets").setDescription("Zeige Ticket-Statistiken"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("overview")
      .setDescription("Zeige allgemeine Bot-Übersicht"),
  );

export async function execute(interaction: any) {
  // Feature check - Block command if statistics are disabled
  const isStatisticsFeatureEnabled = await featureManager.isFeatureEnabled(
    interaction.guild.id,
    "statistics",
  );

  if (!isStatisticsFeatureEnabled) {
    return await interaction.reply({
      content: "⛔ Das Statistik-System ist für diesen Server deaktiviert.",
      ephemeral: true,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "commands":
      await showCommandStats(interaction);
      break;
    case "tickets":
      await showTicketStats(interaction);
      break;
    case "overview":
      await showOverview(interaction);
      break;
  }
}

async function showCommandStats(interaction: any) {
  const days = interaction.options.getInteger("days") || 30;
  const guildId = interaction.guild.id;

  try {
    const stats = (await dbManager.getCommandStats(guildId, days)) as any[];

    if (stats.length === 0) {
      const embed = EmbedBuilderFeature.createInfoEmbed(
        `Keine Command-Statistiken für die letzten ${days} Tage gefunden.`,
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const totalCommands = stats.reduce(
      (sum, stat) => sum + stat.usage_count,
      0,
    );
    const commandList = stats
      .slice(0, 10)
      .map(
        (stat, index) =>
          `${index + 1}. **${stat.command_name}** - ${stat.usage_count} mal verwendet`,
      )
      .join("\n");

    const embed = EmbedBuilderFeature.createAdvancedEmbed({
      title: "📊 Command Statistiken",
      description: `**Zeitraum:** Letzten ${days} Tage\n**Gesamt:** ${totalCommands} Commands\n\n${commandList}`,
      color: 0x00ae86,
      footer: { text: "Top 10 Commands" },
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      "Fehler beim Abrufen der Command-Statistiken!",
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function showTicketStats(interaction: any) {
  const guildId = interaction.guild.id;

  try {
    const allTickets = (await dbManager.getTickets(guildId)) as any[];
    const openTickets = allTickets.filter((t) => t.status === "open");
    const closedTickets = allTickets.filter((t) => t.status === "closed");

    // Calculate average resolution time for closed tickets
    let avgResolutionTime = 0;
    if (closedTickets.length > 0) {
      const totalResolutionTime = closedTickets.reduce((sum, ticket) => {
        const created = new Date(ticket.created_at);
        const closed = new Date(ticket.closed_at);
        return sum + (closed.getTime() - created.getTime());
      }, 0);
      avgResolutionTime =
        totalResolutionTime / closedTickets.length / (1000 * 60 * 60); // in hours
    }

    const embed = EmbedBuilderFeature.createAdvancedEmbed({
      title: "🎫 Ticket Statistiken",
      fields: [
        {
          name: "Gesamt Tickets",
          value: allTickets.length.toString(),
          inline: true,
        },
        {
          name: "Offene Tickets",
          value: openTickets.length.toString(),
          inline: true,
        },
        {
          name: "Geschlossene Tickets",
          value: closedTickets.length.toString(),
          inline: true,
        },
        {
          name: "Durchschnittliche Bearbeitungszeit",
          value: `${avgResolutionTime.toFixed(1)} Stunden`,
          inline: false,
        },
      ],
      color: 0x00ae86,
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      "Fehler beim Abrufen der Ticket-Statistiken!",
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function showOverview(interaction: any) {
  const guildId = interaction.guild.id;

  try {
    const [tickets, responses, webhooks, commandStats] = await Promise.all([
      dbManager.getTickets(guildId) as Promise<any[]>,
      dbManager.getAutoResponses(guildId) as Promise<any[]>,
      dbManager.getWebhooks(guildId) as Promise<any[]>,
      dbManager.getCommandStats(guildId, 7) as Promise<any[]>,
    ]);

    const openTickets = tickets.filter((t) => t.status === "open").length;
    const totalCommands = commandStats.reduce(
      (sum, stat) => sum + stat.usage_count,
      0,
    );

    const embed = EmbedBuilderFeature.createAdvancedEmbed({
      title: "🤖 Bot Übersicht",
      fields: [
        {
          name: "🎫 Offene Tickets",
          value: openTickets.toString(),
          inline: true,
        },
        {
          name: "🤖 Auto-Responses",
          value: responses.length.toString(),
          inline: true,
        },
        {
          name: "🔗 Webhooks",
          value: webhooks.length.toString(),
          inline: true,
        },
        {
          name: "📊 Commands (7 Tage)",
          value: totalCommands.toString(),
          inline: true,
        },
        { name: "⚡ Status", value: "Online", inline: true },
        {
          name: "📅 Letzter Neustart",
          value: new Date().toLocaleDateString("de-DE"),
          inline: true,
        },
      ],
      color: 0x00ae86,
      footer: { text: "Bot läuft erfolgreich" },
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      "Fehler beim Abrufen der Bot-Übersicht!",
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
