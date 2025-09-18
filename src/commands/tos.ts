import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("tos")
  .setDescription("Zeigt die Nutzungsbedingungen des Bots an");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("📋 Terms of Service (Nutzungsbedingungen)")
    .setDescription(
      "Hier findest du die vollständigen Nutzungsbedingungen für BotTrapper.\n\n" +
      "Durch die Verwendung des Bots erklärst du dich mit diesen Bedingungen einverstanden.\n\n" +
      "**[» Vollständige Nutzungsbedingungen lesen](https://bottrapper.me/tos)**"
    )
    .setColor(0x3b82f6) // blue-500
    .addFields(
      {
        name: "🔸 Kurzzusammenfassung",
        value: 
          "• Bot wird kostenlos bereitgestellt\n" +
          "• Keine Garantie für ständige Verfügbarkeit\n" +
          "• Verbot von Spam und illegalem Content\n" +
          "• Einhaltung der Discord Terms of Service erforderlich",
        inline: false
      },
      {
        name: "📞 Kontakt",
        value: "support@bottrapper.me",
        inline: false
      }
    )
    .setTimestamp()
    .setFooter({
      text: `BotTrapper • Zuletzt aktualisiert: 18.09.2025`,
      iconURL: interaction.client.user?.displayAvatarURL(),
    });

  await interaction.reply({ embeds: [embed] });
}