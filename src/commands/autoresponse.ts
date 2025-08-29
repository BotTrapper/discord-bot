import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { AutoResponseFeature } from '../features/autoResponse.js';
import { EmbedBuilderFeature } from '../features/embedBuilder.js';

export const data = new SlashCommandBuilder()
  .setName('autoresponse')
  .setDescription('Verwalte automatische Antworten')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Füge eine automatische Antwort hinzu')
      .addStringOption(option =>
        option.setName('trigger')
          .setDescription('Auslöser-Wort/Phrase')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('response')
          .setDescription('Antwort-Text')
          .setRequired(true))
      .addBooleanOption(option =>
        option.setName('embed')
          .setDescription('Als Embed senden')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Entferne eine automatische Antwort')
      .addStringOption(option =>
        option.setName('trigger')
          .setDescription('Auslöser-Wort/Phrase')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Zeige alle automatischen Antworten'));

export async function execute(interaction: any) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'add':
      await addAutoResponse(interaction);
      break;
    case 'remove':
      await removeAutoResponse(interaction);
      break;
    case 'list':
      await listAutoResponses(interaction);
      break;
  }
}

async function addAutoResponse(interaction: any) {
  const trigger = interaction.options.getString('trigger');
  const response = interaction.options.getString('response');
  const isEmbed = interaction.options.getBoolean('embed') || false;

  try {
    const { dbManager } = await import('../database/database.js');
    
    if (isEmbed) {
      await dbManager.addAutoResponse({
        trigger,
        response,
        isEmbed: true,
        embedTitle: 'Automatische Antwort',
        embedDescription: response,
        embedColor: 0x00AE86,
        guildId: interaction.guild.id
      });
    } else {
      await dbManager.addAutoResponse({
        trigger,
        response,
        isEmbed: false,
        guildId: interaction.guild.id
      });
    }

    const embed = EmbedBuilderFeature.createSuccessEmbed(
      `Automatische Antwort für "${trigger}" wurde hinzugefügt!`
    );

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Hinzufügen der automatischen Antwort!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function removeAutoResponse(interaction: any) {
  const trigger = interaction.options.getString('trigger');
  
  try {
    const { dbManager } = await import('../database/database.js');
    await dbManager.removeAutoResponse(trigger, interaction.guild.id);

    const embed = EmbedBuilderFeature.createSuccessEmbed(
      `Automatische Antwort für "${trigger}" wurde entfernt!`
    );

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Entfernen der automatischen Antwort!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function listAutoResponses(interaction: any) {
  try {
    const { dbManager } = await import('../database/database.js');
    const responses = await dbManager.getAutoResponses(interaction.guild.id) as any[];

    if (responses.length === 0) {
      const embed = EmbedBuilderFeature.createInfoEmbed('Keine automatischen Antworten konfiguriert.');
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const responseList = responses.map((r, index) => 
      `${index + 1}. **${r.trigger_word}** → ${r.is_embed ? '(Embed)' : r.response_text}`
    ).join('\n');

    const embed = EmbedBuilderFeature.createAdvancedEmbed({
      title: '🤖 Automatische Antworten',
      description: responseList,
      color: 0x00AE86
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = EmbedBuilderFeature.createErrorEmbed(
      'Fehler beim Abrufen der automatischen Antworten!'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
