import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  type Interaction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
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
import * as ticketCommand from "./commands/ticket.js";
import * as embedCommand from "./commands/embed.js";
import * as autoresponseCommand from "./commands/autoresponse.js";
import * as statsCommand from "./commands/stats.js";
import * as changelogCommand from "./commands/changelog.js";
import * as autoroleCommand from "./commands/autorole.js";
import * as bottrapperCommand from "./commands/bottrapper.js";
import "dotenv/config";

// Function to safely convert hex color to Discord integer
function hexToDiscordColor(hexColor: string): number {
  try {
    // Remove # if present and ensure it's valid
    const cleanHex = hexColor.replace("#", "").trim();

    // Validate hex format (6 characters)
    if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
      console.warn(
        `Invalid hex color: ${hexColor}, using default Discord blurple`,
      );
      return 0x5865f2; // Discord blurple as fallback
    }

    const colorInt = parseInt(cleanHex, 16);
    console.log(`Converting color ${hexColor} to Discord integer: ${colorInt}`);
    return colorInt;
  } catch (error) {
    console.warn(`Error parsing color ${hexColor}:`, error);
    return 0x5865f2; // Discord blurple as fallback
  }
}

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

// Function to generate channel transcript
async function generateChannelTranscript(channel: any): Promise<string> {
  try {
    console.log(`🔄 Generating transcript for channel ${channel.name}...`);

    // Fetch all messages from the channel
    const messages: any[] = [];
    let lastMessageId: string | undefined;

    // Discord API allows fetching max 100 messages per request
    while (true) {
      const options: any = { limit: 100 };
      if (lastMessageId) {
        options.before = lastMessageId;
      }

      const fetchedMessages = await channel.messages.fetch(options);

      if (fetchedMessages.size === 0) {
        break;
      }

      messages.push(...Array.from(fetchedMessages.values()));
      lastMessageId = fetchedMessages.last()?.id;

      // Safety limit to prevent infinite loops or extremely large transcripts
      if (messages.length > 1000) {
        console.log(
          `⚠️ Transcript limited to 1000 messages for channel ${channel.name}`,
        );
        break;
      }
    }

    // Sort messages by creation time (oldest first)
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Create a member cache for ID resolution
    const memberCache = new Map();
    try {
      // Fetch guild members for ID resolution
      if (channel.guild) {
        const members = await channel.guild.members.fetch();
        members.forEach((member: any) => {
          memberCache.set(member.id, {
            username: member.user.username,
            displayName: member.displayName,
            nickname: member.nickname,
          });
        });
        console.log(`✅ Cached ${memberCache.size} members for ID resolution`);
      }
    } catch (memberError) {
      console.warn(
        "⚠️ Could not fetch guild members for ID resolution:",
        memberError,
      );
    }

    // Function to resolve mentions in text
    const resolveMentions = (text: string): string => {
      if (!text) return text;

      // Resolve user mentions <@123123> and <@!123123>
      text = text.replace(/<@!?(\d+)>/g, (match, userId) => {
        const member = memberCache.get(userId);
        if (member) {
          return `@${member.displayName || member.username}`;
        }
        return match; // Keep original if not found
      });

      // Resolve channel mentions <#123123>
      text = text.replace(/<#(\d+)>/g, (match, channelId) => {
        if (channel.guild) {
          const mentionedChannel = channel.guild.channels.cache.get(channelId);
          if (mentionedChannel) {
            return `#${mentionedChannel.name}`;
          }
        }
        return match; // Keep original if not found
      });

      // Resolve role mentions <@&123123>
      text = text.replace(/<@&(\d+)>/g, (match, roleId) => {
        if (channel.guild) {
          const role = channel.guild.roles.cache.get(roleId);
          if (role) {
            return `@${role.name}`;
          }
        }
        return match; // Keep original if not found
      });

      return text;
    };

    // Generate structured transcript data as JSON
    const transcriptData = {
      header: {
        channelName: channel.name,
        channelId: channel.id,
        guildName: channel.guild?.name,
        generated: new Date().toISOString(),
        totalMessages: messages.length,
        memberCount: memberCache.size,
      },
      messages: messages.map((message) => ({
        id: message.id,
        timestamp: message.createdAt.toISOString(),
        author: {
          id: message.author.id,
          username: message.author.username,
          discriminator: message.author.discriminator,
          avatar: message.author.avatar,
          bot: message.author.bot,
          displayName: message.member?.displayName || message.author.username,
        },
        content: resolveMentions(message.content), // Resolve mentions in content
        attachments: message.attachments.map((attachment: any) => ({
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxyUrl: attachment.proxyUrl,
          size: attachment.size,
          contentType: attachment.contentType,
          width: attachment.width,
          height: attachment.height,
        })),
        embeds: message.embeds.map((embed: any) => ({
          title: embed.title ? resolveMentions(embed.title) : undefined,
          description: embed.description
            ? resolveMentions(embed.description)
            : undefined,
          url: embed.url,
          color: embed.color,
          timestamp: embed.timestamp,
          footer: embed.footer
            ? {
                text: resolveMentions(embed.footer.text),
                iconURL: embed.footer.iconURL,
              }
            : undefined,
          image: embed.image,
          thumbnail: embed.thumbnail,
          author: embed.author
            ? {
                name: resolveMentions(embed.author.name),
                url: embed.author.url,
                iconURL: embed.author.iconURL,
              }
            : undefined,
          fields: embed.fields?.map((field: any) => ({
            name: resolveMentions(field.name),
            value: resolveMentions(field.value),
            inline: field.inline,
          })),
        })),
        reactions: message.reactions.cache.map((reaction: any) => ({
          emoji: {
            name: reaction.emoji.name,
            id: reaction.emoji.id,
            animated: reaction.emoji.animated,
          },
          count: reaction.count,
        })),
        edited: message.editedTimestamp ? message.editedAt.toISOString() : null,
        pinned: message.pinned,
        type: message.type,
      })),
    };

    console.log(
      `✅ Generated structured transcript with ${messages.length} messages for channel ${channel.name}`,
    );
    console.log(
      `✅ Resolved mentions using ${memberCache.size} cached members`,
    );
    return JSON.stringify(transcriptData, null, 2);
  } catch (error) {
    console.error("Error generating transcript:", error);

    // Return a basic error transcript rather than failing completely
    const errorData = {
      header: {
        channelName: channel?.name || "Unknown",
        error: error instanceof Error ? error.message : "Unknown error",
        generated: new Date().toISOString(),
      },
      messages: [],
    };

    return JSON.stringify(errorData, null, 2);
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
      }, 5000); // Wait 5 seconds after startup to ensure everything is ready

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
        if (interaction.customId === "close_ticket") {
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

          const channel = interaction.channel;

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
            content: "🔒 Ticket wird in 5 Sekunden geschlossen...",
          });

          setTimeout(async () => {
            try {
              await channel.delete();
            } catch (error) {
              console.error("Error deleting channel:", error);
            }
          }, 5000);
        }

        // Kategorie-Ticket Button Handler
        if (interaction.customId?.startsWith("create_ticket_")) {
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

          const categoryId = interaction.customId.replace("create_ticket_", "");

          // Import der createCategoryTicket Funktion
          const { createCategoryTicket } = await import("./commands/ticket.js");
          await createCategoryTicket(interaction, categoryId);
        }

        // Legacy Button (für Rückwärtskompatibilität)
        if (interaction.customId === "create_ticket_button") {
          await interaction.reply({
            content:
              "Verwende das neue Ticket-System mit Kategorien! Führe `/ticket setup` aus.",
            flags: 64,
          });
        }
      }

      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        if (interaction.customId?.startsWith("create_ticket_modal_")) {
          const categoryId = interaction.customId.replace(
            "create_ticket_modal_",
            "",
          );
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
      }
    });

    // Handle process termination
    process.on("SIGINT", () => {
      console.log("\n🛑 Bot shutting down...");
      dbManager.close();
      client.destroy();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\n🛑 Bot shutting down...");
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
    console.log("🔔 Notification manager initialized");
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

main();
