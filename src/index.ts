import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  type Interaction,
} from "discord.js";
import { AutoResponseFeature } from "./features/autoResponse.js";
import { PermissionManager } from "./features/permissionManager.js";
import { featureManager, type FeatureName } from "./features/featureManager.js";
import { notificationManager } from "./features/notificationManager.js";
import { dbManager } from "./database/database.js";
import {
  initializeDatabase,
  initializeGuildDefaults,
} from "./database/migrations.js";
import {
  startApiServer,
  setDiscordClient,
  setRegisterGuildCommandsFunction,
} from "./api/server.js";
import { versionManager } from "./utils/version.js";
import { logger } from "./utils/logger.js";
import { initSentry, captureException, flush as flushSentry } from "./utils/sentry.js";
import { handleButtonInteraction } from "./handlers/buttonHandler.js";
import { handleModalInteraction } from "./handlers/modalHandler.js";
import { NOTIFICATION_STARTUP_DELAY_MS } from "./config/constants.js";
import * as ticketCommand from "./commands/ticket.js";
import * as embedCommand from "./commands/embed.js";
import * as autoresponseCommand from "./commands/autoresponse.js";
import * as statsCommand from "./commands/stats.js";
import * as changelogCommand from "./commands/changelog.js";
import * as autoroleCommand from "./commands/autorole.js";
import * as bottrapperCommand from "./commands/bottrapper.js";
import * as tosCommand from "./commands/tos.js";
import * as dataCommand from "./commands/data.js";
import "dotenv/config";

// Initialize Sentry error tracking (if SENTRY_DSN is configured)
initSentry();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // Hinzugefügt für Member-Zugriff
  ],
});

// Commands collection
const commands = new Collection();
commands.set(ticketCommand.data.name, ticketCommand);
commands.set(embedCommand.data.name, embedCommand);
commands.set(autoresponseCommand.data.name, autoresponseCommand);
commands.set(statsCommand.data.name, statsCommand);
commands.set(changelogCommand.data.name, changelogCommand);
commands.set(autoroleCommand.data.name, autoroleCommand);
commands.set(bottrapperCommand.data.name, bottrapperCommand);
commands.set(tosCommand.data.name, tosCommand);
commands.set(dataCommand.data.name, dataCommand);

// Map commands to their required features
const COMMAND_FEATURE_MAP: Record<string, string> = {
  ticket: "tickets",
  autoresponse: "autoresponses",
  stats: "statistics",
  autorole: "autoroles",
  // 'embed' is always available (no feature requirement)
  // 'changelog' is always available (no feature requirement)
};

const TOKEN = process.env.DISCORD_TOKEN || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const GUILD_ID = process.env.GUILD_ID || ""; // Optional: nur für Development/Testing

const commandsData = [
  ticketCommand.data.toJSON(),
  embedCommand.data.toJSON(),
  autoresponseCommand.data.toJSON(),
  statsCommand.data.toJSON(),
  changelogCommand.data.toJSON(),
  autoroleCommand.data.toJSON(),
  bottrapperCommand.data.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  try {
    if (GUILD_ID) {
      // Development: Register commands für einen spezifischen Server (sofort verfügbar)
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commandsData,
      });
      console.log("✅ Guild-specific slash commands registered.");
    } else {
      // Production: Register global commands (verfügbar auf allen Servern)
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commandsData,
      });
      console.log("✅ Global slash commands registered for all servers.");
    }
  } catch (error) {
    console.error("❌ Error registering commands:", error);
  }
}

// New function: Register commands for specific guild based on enabled features
async function registerGuildCommands(guildId: string) {
  try {
    console.log(`🔄 Updating commands for guild ${guildId}...`);

    // Get enabled features for this guild
    const enabledFeatures = await featureManager.getEnabledFeatures(guildId);
    console.log(`Enabled features for guild ${guildId}:`, enabledFeatures);

    // Filter commands based on enabled features
    const availableCommands = commandsData.filter((commandData) => {
      const requiredFeature = COMMAND_FEATURE_MAP[commandData.name];

      // If no feature requirement, always include (like 'embed' command)
      if (!requiredFeature) return true;

      // Only include if feature is enabled
      return enabledFeatures.includes(requiredFeature as FeatureName);
    });

    console.log(
      `Registering ${availableCommands.length}/${commandsData.length} commands for guild ${guildId}`,
    );
    console.log(
      "Available commands:",
      availableCommands.map((cmd) => cmd.name),
    );

    // Register only available commands for this guild
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), {
      body: availableCommands,
    });

    console.log(`✅ Guild commands updated for ${guildId}`);
  } catch (error) {
    console.error(`❌ Error updating guild commands for ${guildId}:`, error);
  }
}

// Initialize data from database for all guilds
async function initializeGuildData() {
  try {
    console.log("🔧 Initializing guild data...");
    const guilds = client.guilds.cache;

    for (const guild of guilds.values()) {
      console.log(`🏛️  Initializing guild: ${guild.name} (${guild.id})`);
      await initializeGuildDefaults(guild.id);
    }

    console.log("✅ Guild data initialized from database");
  } catch (error) {
    console.error("❌ Error initializing guild data:", error);
  }
}

// Starte den API Server und verbinde den Discord Client
async function main() {
  try {
    // Log version information
    const versionInfo = versionManager.getVersionInfo();
    console.log(`🚀 Starting ${versionInfo.name} v${versionInfo.version}`);
    console.log(`📅 Started at: ${versionInfo.startTime.toISOString()}`);

    await initializeDatabase();

    client.once("ready", async () => {
      console.log(`✅ Bot is ready! Logged in as ${client.user?.tag}`);

      // Verbinde den Discord Client mit dem API Server
      setDiscordClient(client);

      // Set Discord client for notification manager
      notificationManager.setDiscordClient(client);

      // Register the guild commands function with the API server
      setRegisterGuildCommandsFunction(registerGuildCommands);

      // Register commands
      await registerCommands();

      // Initialize guild data from database
      await initializeGuildData();

      // Check and send automatic version notifications
      setTimeout(async () => {
        await notificationManager.checkAndSendVersionNotifications();
      }, NOTIFICATION_STARTUP_DELAY_MS); // Wait for startup to ensure everything is ready

      console.log("🚀 Bot is fully ready!");
    });

    // Debug: Log member-related events (but don't duplicate guildMemberAdd)
    client.on("guildMemberRemove", (member) => {
      console.log(
        `🔥 [EVENT] guildMemberRemove: ${member.user.username} left ${member.guild.name}`,
      );
    });

    client.on("guildMemberUpdate", (oldMember, newMember) => {
      console.log(
        `🔥 [EVENT] guildMemberUpdate: ${newMember.user.username} updated in ${newMember.guild.name}`,
      );
    });

    // Debug: General event logging for debugging
    console.log("🔧 [DEBUG] Setting up event listeners...");

    // Handle new guilds
    client.on("guildCreate", async (guild) => {
      console.log(`🎉 Bot added to new guild: ${guild.name} (${guild.id})`);

      try {
        // Initialize default data for new guild
        await initializeGuildDefaults(guild.id);

        console.log(`✅ Guild ${guild.name} initialized`);
      } catch (error) {
        console.error(`❌ Error initializing guild ${guild.name}:`, error);
      }
    });

    // Handle new members joining - Auto Role assignment
    client.on("guildMemberAdd", async (member) => {
      try {
        // Check if autoroles feature is enabled for this guild
        const isAutoRolesEnabled = await featureManager.isFeatureEnabled(
          member.guild.id,
          "autoroles",
        );

        if (!isAutoRolesEnabled) {
          return;
        }

        // Get active auto roles for this guild
        const autoRoles = await dbManager.getActiveAutoRoles(member.guild.id);

        if (autoRoles.length === 0) {
          return;
        }

        console.log(
          `🎭 Assigning auto roles to ${member.user.username} in ${member.guild.name}`,
        );

        // Assign each active auto role to the new member
        for (const autoRole of autoRoles) {
          try {
            const role = member.guild.roles.cache.get(autoRole.role_id);
            if (role) {
              await member.roles.add(role);
              console.log(
                `✅ Assigned role "${role.name}" to ${member.user.username}`,
              );
            } else {
              console.warn(
                `⚠️ Role with ID ${autoRole.role_id} not found in guild ${member.guild.name}`,
              );
              // Optionally mark role as inactive in database
              await dbManager.updateAutoRole(
                member.guild.id,
                autoRole.role_id,
                { isActive: false },
              );
            }
          } catch (roleError) {
            console.error(
              `❌ Failed to assign role ${autoRole.role_name} to ${member.user.username}:`,
              roleError,
            );
          }
        }
      } catch (error) {
        console.error(
          `❌ Auto role assignment failed for ${member.user.username}:`,
          error,
        );
      }
    });

    // Handle slash commands
    client.on("interactionCreate", async (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) return;

        // Check permissions (now async)
        const hasPermission = await PermissionManager.checkCommandPermission(
          interaction,
          interaction.commandName,
        );
        if (!hasPermission) {
          await interaction.reply({
            content: "❌ Du hast keine Berechtigung für diesen Befehl!",
            ephemeral: true,
          });
          return;
        }

        try {
          // Log command usage
          await dbManager.logCommand(
            interaction.commandName,
            interaction.user.id,
            interaction.guild?.id || "DM",
          );

          await (command as any).execute(interaction);
        } catch (error) {
          console.error("Command execution error:", error);

          const reply = {
            content: "❌ Es gab einen Fehler beim Ausführen des Befehls!",
            flags: 64,
          };

          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp(reply);
            } else {
              await interaction.reply(reply);
            }
          } catch (replyError) {
            console.error("Failed to send error message to user:", replyError);
            // Interaction ist wahrscheinlich expired - ignorieren
          }
        }
      }

      // Handle button interactions
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }

      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        await handleModalInteraction(interaction);
      }
    });

    // Handle automatic responses
    client.on("messageCreate", async (message) => {
      if (message.author.bot || !message.guild) return;

      try {
        // Get auto responses from database
        const responses = (await dbManager.getAutoResponses(
          message.guild.id,
        )) as any[];
        const autoResponse = responses.find((r) =>
          message.content.toLowerCase().includes(r.trigger_word.toLowerCase()),
        );

        if (autoResponse) {
          if (autoResponse.is_embed) {
            const embed = AutoResponseFeature.createResponseEmbed({
              trigger: autoResponse.trigger_word,
              response: autoResponse.response_text,
              isEmbed: true,
              embedResponse: {
                title: autoResponse.embed_title || "Automatische Antwort",
                description:
                  autoResponse.embed_description || autoResponse.response_text,
                color: autoResponse.embed_color || 0x00ae86,
              },
            });

            if (embed) {
              await message.reply({ embeds: [embed] });
            }
          } else {
            await message.reply(autoResponse.response_text);
          }
        }
      } catch (error) {
        console.error("Error handling auto response:", error);
        captureException(error, { context: "auto_response" });
      }
    });

    // Handle process termination
    process.on("SIGINT", async () => {
      logger.info("Bot shutting down...");
      await flushSentry();
      dbManager.close();
      client.destroy();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("Bot shutting down...");
      await flushSentry();
      dbManager.close();
      client.destroy();
      process.exit(0);
    });

    // Starte den API Server
    startApiServer();

    // Login to Discord
    await client.login(TOKEN);

    // Initialize notification manager with client
    notificationManager.setDiscordClient(client);
    logger.info("Notification manager initialized");
  } catch (error) {
    logger.error("Failed to start bot", { error });
    captureException(error, { context: "bot_startup" });
    await flushSentry();
    process.exit(1);
  }
}

main();
