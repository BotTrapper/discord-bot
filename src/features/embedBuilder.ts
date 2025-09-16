import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export class EmbedBuilderFeature {
  static createBasicEmbed(title: string, description: string, color?: number) {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color || 0x00ae86)
      .setTimestamp();
  }

  static createAdvancedEmbed(options: {
    title?: string;
    description?: string;
    color?: number;
    author?: { name: string; icon?: string };
    footer?: { text: string; icon?: string };
    fields?: { name: string; value: string; inline?: boolean }[];
    thumbnail?: string;
    image?: string;
  }) {
    const embed = new EmbedBuilder();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(options.description);
    if (options.color) embed.setColor(options.color);
    if (options.author) {
      const authorData: any = { name: options.author.name };
      if (options.author.icon) authorData.iconURL = options.author.icon;
      embed.setAuthor(authorData);
    }
    if (options.footer) {
      const footerData: any = { text: options.footer.text };
      if (options.footer.icon) footerData.iconURL = options.footer.icon;
      embed.setFooter(footerData);
    }
    if (options.fields) {
      options.fields.forEach((field) => {
        embed.addFields({
          name: field.name,
          value: field.value,
          inline: field.inline || false,
        });
      });
    }
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);

    embed.setTimestamp();
    return embed;
  }

  static createSuccessEmbed(message: string) {
    return new EmbedBuilder()
      .setTitle("✅ Erfolg")
      .setDescription(message)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  static createErrorEmbed(message: string) {
    return new EmbedBuilder()
      .setTitle("❌ Fehler")
      .setDescription(message)
      .setColor(0xff0000)
      .setTimestamp();
  }

  static createInfoEmbed(message: string) {
    return new EmbedBuilder()
      .setTitle("ℹ️ Information")
      .setDescription(message)
      .setColor(0x0099ff)
      .setTimestamp();
  }
}
