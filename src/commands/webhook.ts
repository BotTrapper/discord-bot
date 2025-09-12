import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { WebhookNotification } from '../features/webhookNotification.js';
import { EmbedBuilderFeature } from '../features/embedBuilder.js';
import { dbManager } from '../database/database.js';
import { featureManager } from '../features/featureManager.js';

export const data = new SlashCommandBuilder()
  .setName('webhook')
  .setDescription('Webhook Verwaltung')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Füge einen neuen Webhook hinzu')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name des Webhooks')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('url')
          .setDescription('Webhook URL')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Entferne einen Webhook')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name des Webhooks')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Zeige alle Webhooks'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('test')
      .setDescription('Teste einen Webhook')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name des Webhooks')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Test-Nachricht')
          .setRequired(false)));

export async function execute(interaction: any) {
  // Feature check - Block command if webhooks are disabled
  const isWebhookFeatureEnabled = await featureManager.isFeatureEnabled(interaction.guild.id, 'webhooks');

  if (!isWebhookFeatureEnabled) {
    return await interaction.reply({
      content: '⛔ Das Webhook-System ist für diesen Server deaktiviert.',
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'add':
      await addWebhook(interaction);
      break;
    case 'remove':
      await removeWebhook(interaction);
      break;
    case 'list':
      await listWebhooks(interaction);
      break;
    case 'test':
      await testWebhook(interaction);
      break;
  }
}

async function addWebhook(interaction: any) {
  const name = interaction.options.getString('name');
  const url = interaction.options.getString('url');
  const guildId = interaction.guild.id;

  try {
    // Validate URL
    new URL(url);
    
    const success = await WebhookNotification.addWebhook(name, url, guildId);
    
    if (success) {
      const embed = EmbedBuilderFeature.createSuccessEmbed(
        `Webhook "${name}" wurde erfolgreich hinzugefügt!`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      throw new Error('Failed to add webhook');
    }
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Hinzufügen des Webhooks. Überprüfe die URL!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function removeWebhook(interaction: any) {
  const name = interaction.options.getString('name');
  const guildId = interaction.guild.id;

  try {
    // Remove from database
    await dbManager.removeWebhook(name, guildId);
    // Remove from memory cache
    WebhookNotification.removeWebhook(name);

    const embed = EmbedBuilderFeature.createSuccessEmbed(
      `Webhook "${name}" wurde entfernt!`
    );

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Entfernen des Webhooks!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function listWebhooks(interaction: any) {
  const guildId = interaction.guild.id;

  try {
    const webhooks = await dbManager.getWebhooks(guildId) as any[];

    if (webhooks.length === 0) {
      const embed = EmbedBuilderFeature.createInfoEmbed('Keine Webhooks konfiguriert.');
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const webhookList = webhooks.map((w, index) => 
      `${index + 1}. **${w.name}** - ${w.url.substring(0, 50)}...`
    ).join('\n');

    const embed = EmbedBuilderFeature.createAdvancedEmbed({
      title: '🔗 Konfigurierte Webhooks',
      description: webhookList,
      color: 0x00AE86
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Abrufen der Webhooks!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function testWebhook(interaction: any) {
  const name = interaction.options.getString('name');
  const message = interaction.options.getString('message') || 'Test-Nachricht vom Discord Bot!';

  try {
    const success = await WebhookNotification.sendNotification(name, {
      content: message,
      username: 'Discord Bot Test'
    });

    if (success) {
      const embed = EmbedBuilderFeature.createSuccessEmbed(
        `Test-Nachricht erfolgreich an Webhook "${name}" gesendet!`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      throw new Error('Webhook test failed');
    }
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      `Fehler beim Testen des Webhooks "${name}"!`
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
