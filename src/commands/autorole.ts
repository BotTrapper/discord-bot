import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { dbManager } from "../database/database.js";
import { featureManager } from "../features/featureManager.js";

const data = new SlashCommandBuilder()
  .setName("autorole")
  .setDescription("Verwalte automatische Rollenzuweisung für neue Mitglieder")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Füge eine Auto-Role hinzu")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Die Rolle, die automatisch zugewiesen werden soll")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Entferne eine Auto-Role")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Die Auto-Role, die entfernt werden soll")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("Zeige alle konfigurierten Auto-Roles an"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("toggle")
      .setDescription("Aktiviere oder deaktiviere eine Auto-Role")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Die Auto-Role, die umgeschaltet werden soll")
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("active")
          .setDescription("Ob die Auto-Role aktiv sein soll")
          .setRequired(true),
      ),
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ Dieser Befehl kann nur in einem Server verwendet werden!",
      ephemeral: true,
    });
    return;
  }

  // Check if autoroles feature is enabled
  const isFeatureEnabled = await featureManager.isFeatureEnabled(
    interaction.guild.id,
    "autoroles",
  );

  if (!isFeatureEnabled) {
    await interaction.reply({
      content:
        "⛔ Das Auto-Role-System ist für diesen Server deaktiviert. Aktiviere es im Dashboard, um diese Befehle zu verwenden.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case "add":
        await handleAddAutoRole(interaction);
        break;
      case "remove":
        await handleRemoveAutoRole(interaction);
        break;
      case "list":
        await handleListAutoRoles(interaction);
        break;
      case "toggle":
        await handleToggleAutoRole(interaction);
        break;
      default:
        await interaction.reply({
          content: "❌ Unbekannter Unterbefehl!",
          ephemeral: true,
        });
    }
  } catch (error) {
    console.error("AutoRole command error:", error);
    const reply = {
      content: "❌ Es gab einen Fehler beim Ausführen des Befehls!",
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
};

async function handleAddAutoRole(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole("role", true);

  if (!interaction.guild) return;

  // Check if role exists and is manageable
  const guildRole = interaction.guild.roles.cache.get(role.id);
  if (!guildRole) {
    await interaction.reply({
      content: "❌ Diese Rolle existiert nicht auf diesem Server!",
      ephemeral: true,
    });
    return;
  }

  // Check if bot has permission to manage this role
  const botMember = interaction.guild.members.me;
  if (!botMember || guildRole.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        "❌ Ich kann diese Rolle nicht verwalten! Sie ist zu hoch in der Hierarchie oder ich habe nicht die nötigen Berechtigungen.",
      ephemeral: true,
    });
    return;
  }

  // Check if role is manageable (not @everyone, not managed by integration)
  if (guildRole.id === interaction.guild.id || guildRole.managed) {
    await interaction.reply({
      content:
        "❌ Diese Rolle kann nicht als Auto-Role verwendet werden (System-Rolle oder von Integration verwaltet)!",
      ephemeral: true,
    });
    return;
  }

  try {
    await dbManager.addAutoRole(interaction.guild.id, role.id, role.name);
    await interaction.reply({
      content: `✅ Die Rolle **${role.name}** wurde erfolgreich als Auto-Role hinzugefügt! Neue Mitglieder erhalten diese Rolle automatisch beim Beitreten.`,
      ephemeral: true,
    });
  } catch (error: any) {
    if (error.message.includes("bereits als Auto-Role")) {
      await interaction.reply({
        content: `❌ Die Rolle **${role.name}** ist bereits als Auto-Role konfiguriert!`,
        ephemeral: true,
      });
    } else {
      throw error;
    }
  }
}

async function handleRemoveAutoRole(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole("role", true);

  if (!interaction.guild) return;

  const result = await dbManager.deleteAutoRole(interaction.guild.id, role.id);

  if (result === 0) {
    await interaction.reply({
      content: `❌ Die Rolle **${role.name}** ist nicht als Auto-Role konfiguriert!`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ Die Auto-Role **${role.name}** wurde erfolgreich entfernt!`,
    ephemeral: true,
  });
}

async function handleListAutoRoles(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;

  const autoRoles = await dbManager.getAutoRoles(interaction.guild.id);

  if (autoRoles.length === 0) {
    await interaction.reply({
      content: "📋 Es sind keine Auto-Roles für diesen Server konfiguriert.",
      ephemeral: true,
    });
    return;
  }

  const roleList = autoRoles
    .map((autoRole: any) => {
      const status = autoRole.is_active ? "🟢 Aktiv" : "🔴 Inaktiv";
      const role = interaction.guild!.roles.cache.get(autoRole.role_id);
      const roleName = role
        ? role.name
        : `${autoRole.role_name} (nicht gefunden)`;
      return `• **${roleName}** - ${status}`;
    })
    .join("\n");

  await interaction.reply({
    content: `📋 **Auto-Roles für ${interaction.guild.name}:**\n\n${roleList}\n\n💡 Neue Mitglieder erhalten automatisch alle aktiven Auto-Roles beim Beitreten.`,
    ephemeral: true,
  });
}

async function handleToggleAutoRole(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole("role", true);
  const isActive = interaction.options.getBoolean("active", true);

  if (!interaction.guild) return;

  const result = await dbManager.updateAutoRole(interaction.guild.id, role.id, {
    isActive,
  });

  if (result === 0) {
    await interaction.reply({
      content: `❌ Die Rolle **${role.name}** ist nicht als Auto-Role konfiguriert!`,
      ephemeral: true,
    });
    return;
  }

  const status = isActive ? "aktiviert" : "deaktiviert";
  await interaction.reply({
    content: `✅ Die Auto-Role **${role.name}** wurde erfolgreich **${status}**!`,
    ephemeral: true,
  });
}

export { data, execute };
