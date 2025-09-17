import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { dbManager } from "../database/database.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VersionNotification {
  version: string;
  title: string;
  description: string;
  features?: string[];
  fixes?: string[];
  link?: string;
  color?: number;
}

export class NotificationManager {
  private static instance: NotificationManager;
  private client: any = null;

  private constructor() {}

  public static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  public setDiscordClient(client: any) {
    this.client = client;
  }

  // Send version notification to all configured guilds
  async sendVersionNotification(notification: VersionNotification) {
    if (!this.client) {
      console.error("❌ Discord client not set in NotificationManager");
      return;
    }

    try {
      console.log(`🔔 Sending version notification: ${notification.version}`);

      // Get all guilds with notification channels
      const notificationChannels = await dbManager.getAllNotificationChannels();

      if (notificationChannels.length === 0) {
        console.log("ℹ️ No guilds with notification channels configured");
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const { guildId, channelId, allowedRoles } of notificationChannels) {
        try {
          const guild = this.client.guilds.cache.get(guildId);
          if (!guild) {
            console.log(`⚠️ Guild ${guildId} not found in cache`);
            failCount++;
            continue;
          }

          const channel = guild.channels.cache.get(channelId);
          if (!channel) {
            console.log(
              `⚠️ Channel ${channelId} not found in guild ${guild.name}`,
            );
            failCount++;
            continue;
          }

          // Check if bot has permission to send messages
          const botMember = guild.members.cache.get(this.client.user?.id);
          if (!botMember) {
            console.log(`⚠️ Bot not found as member in guild ${guild.name}`);
            failCount++;
            continue;
          }

          const permissions = channel.permissionsFor(botMember);
          if (
            !permissions?.has([
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ])
          ) {
            console.log(
              `⚠️ Missing permissions in channel ${channel.name} (${guild.name})`,
            );
            failCount++;
            continue;
          }

          // Create the notification embed
          const embed = this.createVersionEmbed(notification, guild.name);

          // Send notification
          await channel.send({ embeds: [embed] });
          successCount++;

          console.log(`✅ Sent notification to ${guild.name}/${channel.name}`);
        } catch (error) {
          console.error(
            `❌ Failed to send notification to guild ${guildId}:`,
            error,
          );
          failCount++;
        }
      }

      console.log(
        `🎯 Version notification complete: ${successCount} sent, ${failCount} failed`,
      );
    } catch (error) {
      console.error("❌ Error sending version notifications:", error);
    }
  }

  // Create formatted version embed
  private createVersionEmbed(
    notification: VersionNotification,
    guildName?: string,
  ): any {
    const embed = new EmbedBuilder()
      .setTitle(`🚀 ${notification.title}`)
      .setDescription(notification.description)
      .setColor(notification.color || 0x00ff00)
      .addFields([
        {
          name: "📦 Version",
          value: `\`${notification.version}\``,
          inline: true,
        },
        {
          name: "📅 Released",
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      ])
      .setTimestamp()
      .setFooter({
        text: "BotTrapper Update System",
        iconURL: this.client?.user?.displayAvatarURL(),
      });

    // Add features if provided
    if (notification.features && notification.features.length > 0) {
      embed.addFields([
        {
          name: "✨ New Features",
          value: notification.features
            .map((feature) => `• ${feature}`)
            .join("\n"),
          inline: false,
        },
      ]);
    }

    // Add fixes if provided
    if (notification.fixes && notification.fixes.length > 0) {
      embed.addFields([
        {
          name: "🔧 Bug Fixes",
          value: notification.fixes.map((fix) => `• ${fix}`).join("\n"),
          inline: false,
        },
      ]);
    }

    // Add link if provided
    if (notification.link) {
      embed.addFields([
        {
          name: "🔗 More Information",
          value: `[View Details](${notification.link})`,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  // Manual notification for testing
  async sendTestNotification(
    guildId: string,
    message: string = "Test notification from BotTrapper",
  ) {
    if (!this.client) {
      console.error("❌ Discord client not set in NotificationManager");
      return false;
    }

    try {
      const settings = await dbManager.getNotificationSettings(guildId);
      if (!settings?.infoChannelId) {
        console.log("❌ No notification channel configured for this guild");
        return false;
      }

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        console.log("❌ Guild not found");
        return false;
      }

      const channel = guild.channels.cache.get(settings.infoChannelId);
      if (!channel) {
        console.log("❌ Notification channel not found");
        return false;
      }

      const embed = new EmbedBuilder()
        .setTitle("🧪 Test Notification")
        .setDescription(message)
        .setColor(0x00ff00)
        .setTimestamp()
        .setFooter({
          text: "BotTrapper Test System",
          iconURL: this.client.user?.displayAvatarURL(),
        });

      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error("❌ Error sending test notification:", error);
      return false;
    }
  }

  // Update channel permissions based on role configuration
  async updateChannelPermissions(guildId: string, roleIds: string[] = []) {
    if (!this.client) {
      console.error("❌ Discord client not set in NotificationManager");
      return false;
    }

    try {
      const settings = await dbManager.getNotificationSettings(guildId);
      if (!settings?.infoChannelId) {
        console.log("❌ No notification channel configured for this guild");
        return false;
      }

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        console.log("❌ Guild not found");
        return false;
      }

      const channel = guild.channels.cache.get(settings.infoChannelId);
      if (!channel) {
        console.log("❌ Notification channel not found");
        return false;
      }

      // Clear existing role permissions (except owner and bot)
      const existingOverwrites = channel.permissionOverwrites.cache;
      for (const [id, overwrite] of existingOverwrites) {
        // Don't touch owner, bot, or @everyone permissions
        if (
          id !== guild.ownerId &&
          id !== this.client.user?.id &&
          id !== guild.roles.everyone.id
        ) {
          if (overwrite.type === 1) {
            // Role type
            await channel.permissionOverwrites.delete(id);
          }
        }
      }

      // Add new role permissions
      for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
          await channel.permissionOverwrites.create(roleId, {
            ViewChannel: true,
          });
          console.log(`✅ Added view permission for role ${role.name}`);
        }
      }

      // Update database
      await dbManager.updateNotificationSettings(
        guildId,
        settings.notificationCategoryId,
        settings.infoChannelId,
        roleIds,
      );

      console.log(`✅ Updated channel permissions for guild ${guildId}`);
      return true;
    } catch (error) {
      console.error("❌ Error updating channel permissions:", error);
      return false;
    }
  }

  // Check and send automatic version notifications based on package.json
  async checkAndSendVersionNotifications() {
    if (!this.client) {
      console.error("❌ Discord client not set");
      return;
    }

    try {
      // Get current version from package.json
      const packageJsonPath = join(__dirname, "../../package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const currentVersion = packageJson.version;

      console.log(`🔍 Checking version notifications for v${currentVersion}`);

      // Get guilds that need notifications for this version
      const guildsToNotify =
        await dbManager.getGuildsNeedingVersionNotification(currentVersion);

      if (guildsToNotify.length === 0) {
        console.log(`✅ All guilds already notified for v${currentVersion}`);
        return;
      }

      console.log(
        `📢 Sending version notifications to ${guildsToNotify.length} guilds`,
      );

      // Create version notification
      const versionNotification: VersionNotification = {
        version: currentVersion,
        title: `🎉 BotTrapper Update v${currentVersion}`,
        description: `Eine neue Version des BotTrapper Bots ist verfügbar!`,
        features: [
          "Neue Features und Verbesserungen",
          "Performance-Optimierungen",
          "Bug-Fixes und Stabilität",
        ],
        color: 0x00ff00, // Green for updates
        link: "https://github.com/BotTrapper/BotTrapper",
      };

      // Send notifications to all guilds
      let successCount = 0;
      for (const guild of guildsToNotify) {
        try {
          const success = await this.sendVersionNotificationToGuild(
            versionNotification,
            guild.guildId,
          );
          if (success) {
            // Update the last notification version for this guild
            await dbManager.updateNotificationSettings(
              guild.guildId,
              null, // Don't change category
              null, // Don't change channel
              [], // Don't change roles
              true, // Don't change notifications enabled
              currentVersion, // Update last notification version
            );
            successCount++;
          }
        } catch (error) {
          console.error(
            `❌ Failed to send notification to guild ${guild.guildId}:`,
            error,
          );
        }
      }

      console.log(
        `✅ Successfully sent version notifications to ${successCount}/${guildsToNotify.length} guilds`,
      );
    } catch (error) {
      console.error("❌ Error checking version notifications:", error);
    }
  }

  // Send version notification to a specific guild
  private async sendVersionNotificationToGuild(
    notification: VersionNotification,
    guildId: string,
  ): Promise<boolean> {
    try {
      const settings = await dbManager.getNotificationSettings(guildId);
      if (!settings?.infoChannelId) {
        console.log(`⚠️ No info channel configured for guild ${guildId}`);
        return false;
      }

      const channel = await this.client.channels.fetch(settings.infoChannelId);
      if (!channel) {
        console.error(
          `❌ Channel ${settings.infoChannelId} not found for guild ${guildId}`,
        );
        return false;
      }

      const embed = this.createVersionEmbed(notification);

      let mentionString = "";
      if (settings.notificationRoles && settings.notificationRoles.length > 0) {
        const mentions = settings.notificationRoles
          .map((roleId: string) => `<@&${roleId}>`)
          .join(" ");
        mentionString = mentions;
      }

      await channel.send({
        content: mentionString,
        embeds: [embed],
      });

      console.log(`✅ Version notification sent to guild ${guildId}`);
      return true;
    } catch (error) {
      console.error(
        `❌ Error sending version notification to guild ${guildId}:`,
        error,
      );
      return false;
    }
  }
}

// Export singleton instance
export const notificationManager = NotificationManager.getInstance();
