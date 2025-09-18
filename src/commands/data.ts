import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("data")
  .setDescription("Zeigt die Datenschutzerklärung des Bots an");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("🔒 Privacy Policy (Datenschutzerklärung)")
    .setDescription(
      "Hier findest du unsere vollständige Datenschutzerklärung und Informationen darüber, wie wir deine Daten verwenden.\n\n" +
      "**[» Vollständige Datenschutzerklärung lesen](https://bottrapper.me/dataprivacy)**"
    )
    .setColor(0x10b981) // emerald-500
    .addFields(
      {
        name: "📊 Welche Daten werden gespeichert?",
        value: 
          "• Discord Benutzer- und Server-IDs\n" +
          "• Ticket-Inhalte (60 Tage nach Schließung)\n" +
          "• Audit-Logs (90 Tage)\n" +
          "• Debug-Logs (21 Tage)\n" +
          "• Anonymisierte Statistiken",
        inline: false
      },
      {
        name: "🎯 Warum speichern wir Daten?",
        value: 
          "• Bereitstellung der Bot-Funktionen\n" +
          "• Schutz vor Missbrauch\n" +
          "• Fehlerbehebung und Stabilität\n" +
          "• Nachvollziehbare Moderation",
        inline: false
      },
      {
        name: "🛡️ Deine Rechte",
        value: 
          "Du hast Recht auf Auskunft, Berichtigung, Löschung und Widerspruch deiner Daten.",
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