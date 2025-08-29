import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { EmbedBuilderFeature } from '../features/embedBuilder.js';

export const data = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Erstelle ein benutzerdefiniertes Embed')
  .addStringOption(option =>
    option.setName('title')
      .setDescription('Titel des Embeds')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('description')
      .setDescription('Beschreibung des Embeds')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('color')
      .setDescription('Farbe des Embeds (hex ohne #)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('thumbnail')
      .setDescription('URL für Thumbnail')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('image')
      .setDescription('URL für Bild')
      .setRequired(false));

export async function execute(interaction: any) {
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const colorHex = interaction.options.getString('color');
  const thumbnail = interaction.options.getString('thumbnail');
  const image = interaction.options.getString('image');

  let color = 0x00AE86;
  if (colorHex) {
    try {
      color = parseInt(colorHex, 16);
    } catch (error) {
      await interaction.reply({ content: 'Ungültige Farbe! Verwende ein Hex-Format ohne #', ephemeral: true });
      return;
    }
  }

  const embed = EmbedBuilderFeature.createAdvancedEmbed({
    title,
    description,
    color,
    thumbnail,
    image,
    author: { name: interaction.user.username },
    footer: { text: 'Erstellt mit dem Embed Builder' }
  });

  await interaction.reply({ embeds: [embed] });
}
