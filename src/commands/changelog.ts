import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { versionManager } from "../utils/version.js";

// Changelog data - in a real app, this could come from a database or file
const changelog = [
  {
    version: "1.0.0",
    date: "2025-09-12",
    type: "major",
    changes: {
      added: [
        "Initial release of BotTrapper",
        "Ticket system with categories",
        "Auto-response system with embed support",
        "Permission management system",
        "Statistics dashboard",
        "Feature toggle system",
        "Discord OAuth2 dashboard",
        "Version tracking and changelog",
      ],
      changed: [],
      fixed: [],
      removed: [],
    },
  },
];

export const data = new SlashCommandBuilder()
  .setName("changelog")
  .setDescription(
    "Zeigt Informationen über die aktuelle Version und Änderungen an",
  )
  .addStringOption((option) =>
    option
      .setName("version")
      .setDescription("Spezifische Version anzeigen (optional)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const requestedVersion = interaction.options.getString("version");
  const currentVersion = versionManager.getVersion();
  const versionInfo = versionManager.getVersionInfo();
  const uptime = versionManager.getUptimeString();

  if (requestedVersion) {
    // Show specific version
    const versionEntry = changelog.find(
      (entry) => entry.version === requestedVersion,
    );

    if (!versionEntry) {
      await interaction.reply({
        content: `❌ Version **${requestedVersion}** wurde nicht gefunden!`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Changelog - Version ${versionEntry.version}`)
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({
        text: "BotTrapper",
        iconURL: interaction.client.user?.displayAvatarURL(),
      });

    // Format date
    const date = new Date(versionEntry.date).toLocaleDateString("de-DE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    embed.addFields({ name: "📅 Datum", value: date, inline: true });
    embed.addFields({
      name: "🏷️ Typ",
      value: versionEntry.type.toUpperCase(),
      inline: true,
    });

    // Add changes
    const changeTypeEmojis: Record<string, string> = {
      added: "✨",
      changed: "🔄",
      fixed: "🐛",
      removed: "🗑️",
    };

    const changeTypeLabels: Record<string, string> = {
      added: "Hinzugefügt",
      changed: "Geändert",
      fixed: "Behoben",
      removed: "Entfernt",
    };

    Object.entries(versionEntry.changes).forEach(([type, items]) => {
      if (items && items.length > 0) {
        const emoji = changeTypeEmojis[type] || "•";
        const label = changeTypeLabels[type] || type;
        const value = items.map((item) => `• ${item}`).join("\n");

        if (value.length <= 1024) {
          embed.addFields({
            name: `${emoji} ${label}`,
            value: value,
            inline: false,
          });
        } else {
          // Split long content
          const chunks = [];
          let currentChunk = "";
          for (const item of items) {
            const line = `• ${item}\n`;
            if (currentChunk.length + line.length > 1024) {
              chunks.push(currentChunk);
              currentChunk = line;
            } else {
              currentChunk += line;
            }
          }
          if (currentChunk) chunks.push(currentChunk);

          chunks.forEach((chunk, index) => {
            embed.addFields({
              name:
                index === 0
                  ? `${emoji} ${label}`
                  : `${emoji} ${label} (Fortsetzung)`,
              value: chunk,
              inline: false,
            });
          });
        }
      }
    });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // Show current version and summary
  const embed = new EmbedBuilder()
    .setTitle("🤖 BotTrapper - Versionsinformationen")
    .setDescription(`Aktuelle Version des BotTrapper Discord Bots`)
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({
      text: "BotTrapper",
      iconURL: interaction.client.user?.displayAvatarURL(),
    });

  embed.addFields(
    { name: "🏷️ Version", value: `**v${currentVersion}**`, inline: true },
    { name: "⏱️ Uptime", value: uptime, inline: true },
    {
      name: "📅 Gestartet",
      value: `<t:${Math.floor(versionInfo.startTime.getTime() / 1000)}:R>`,
      inline: true,
    },
  );

  // Add latest changelog entry if available
  const latestEntry = changelog[0];
  if (latestEntry) {
    const date = new Date(latestEntry.date).toLocaleDateString("de-DE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let changesSummary = "";
    Object.entries(latestEntry.changes).forEach(([type, items]) => {
      if (items && items.length > 0) {
        const emoji =
          type === "added"
            ? "✨"
            : type === "changed"
              ? "🔄"
              : type === "fixed"
                ? "🐛"
                : "🗑️";
        changesSummary += `${emoji} ${items.length} ${
          type === "added"
            ? "hinzugefügt"
            : type === "changed"
              ? "geändert"
              : type === "fixed"
                ? "behoben"
                : "entfernt"
        }\n`;
      }
    });

    embed.addFields({
      name: "📋 Letzte Änderungen",
      value: `**v${latestEntry.version}** (${date})\n${changesSummary}`,
      inline: false,
    });
  }

  embed.addFields({
    name: "🔗 Links",
    value:
      "• Dashboard für weitere Details\n• `/changelog <version>` für spezifische Versionen",
    inline: false,
  });

  await interaction.reply({ embeds: [embed] });
}
