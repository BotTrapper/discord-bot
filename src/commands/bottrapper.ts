import {
  SlashCommandBuilder,
  CommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
} from "discord.js";
import { dbManager } from "../database/database.js";

export const data = new SlashCommandBuilder()
  .setName("bottrapper")
  .setDescription("Bot-System Verwaltung")
  .setDefaultMemberPermissions(0) // No default permissions - we check owner in execute
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Richtet das Notification System ein")
      .addChannelOption((option) =>
        option
          .setName("info_channel")
          .setDescription("Der Channel für Bot-Benachrichtigungen")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ Dieser Command kann nur auf Servern verwendet werden.",
      ephemeral: true,
    });
  }

  // Check if user is server owner
  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({
      content: "❌ Nur der Server-Owner kann diesen Command verwenden.",
      ephemeral: true,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "setup") {
    return handleSetup(interaction);
  }

  return interaction.reply({
    content: "❌ Unbekannter Subcommand.",
    ephemeral: true,
  });
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const infoChannel = interaction.options.getChannel("info_channel", true);
    if (!infoChannel || infoChannel.type !== ChannelType.GuildText) {
      return interaction.editReply({
        content: "❌ Der angegebene Channel ist kein Text-Channel.",
      });
    }

    const guildId = interaction.guild!.id;
    const channelId = infoChannel.id;

    // Fetch the actual channel to check permissions and send message
    const actualChannel = await interaction.guild!.channels.fetch(channelId);
    if (!actualChannel || actualChannel.type !== ChannelType.GuildText) {
      return interaction.editReply({
        content: "❌ Channel konnte nicht gefunden werden.",
      });
    }

    // Check if bot has permissions in the channel
    const botMember = interaction.guild!.members.cache.get(
      interaction.client.user!.id,
    );
    if (!botMember) {
      return interaction.editReply({
        content: "❌ Bot-Member konnte nicht gefunden werden.",
      });
    }

    const permissions = actualChannel.permissionsFor(botMember);
    if (
      !permissions ||
      !permissions.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
    ) {
      return interaction.editReply({
        content: `❌ Der Bot benötigt folgende Berechtigungen in <#${channelId}>:\n- Channel anzeigen\n- Nachrichten senden\n- Links einbetten`,
      });
    }

    // Update database - using proper parameter format
    await dbManager.updateNotificationSettings(
      guildId,
      null, // notificationCategoryId
      channelId, // infoChannelId
      [], // notificationRoles
      true, // notificationsEnabled
    );

    // Also set setupCompleted to true with separate query
    const pool = (dbManager as any).pool;
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE guild_settings SET notifications_setup_completed = true WHERE guild_id = $1",
        [guildId],
      );
    } finally {
      client.release();
    }

    // Send test notification to confirm setup
    const embed = {
      title: "🎉 Notification System eingerichtet!",
      description: `Das Bot-Notification System wurde erfolgreich eingerichtet.\n\nDieser Channel wird nun für Bot-Update Benachrichtigungen verwendet.`,
      color: 0x22c55e, // green-500
      timestamp: new Date().toISOString(),
      footer: {
        text: `BotTrapper • Version ${process.env.npm_package_version || "1.0.0"}`,
        icon_url: interaction.client.user!.displayAvatarURL(),
      },
    };

    await actualChannel.send({ embeds: [embed] });

    return interaction.editReply({
      content: `✅ **Notification System erfolgreich eingerichtet!**\n\n📢 Info-Channel: <#${channelId}>\n\nDu kannst nun im Dashboard weitere Einstellungen vornehmen und Rollen für Benachrichtigungen auswählen.`,
    });
  } catch (error) {
    console.error("❌ Error in bottrapper setup:", error);
    return interaction.editReply({
      content:
        "❌ Ein Fehler ist beim Setup aufgetreten. Bitte versuche es erneut.",
    });
  }
}
