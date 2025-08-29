# Discord Bot - TypeScript

🤖 Ein vollständiger Discord Bot mit TypeScript, SQLite und Express API.

## 🚀 Features

- **Slash Commands**: Moderne Discord-Interaktionen
- **Ticket System**: Automatisierte Support-Tickets  
- **Embed Builder**: Schöne Discord-Nachrichten erstellen
- **Auto Response**: Automatische Antworten auf Nachrichten
- **Webhook Notifications**: Externe Benachrichtigungen
- **REST API**: Vollständige API für Frontend-Integration
- **SQLite Database**: Persistente Datenspeicherung

## 📋 Voraussetzungen

- Node.js 20+
- Discord Bot Token
- SQLite3

## 🔧 Schnellstart

```bash
# Repository klonen
git clone https://github.com/yourusername/discord-bot.git
cd discord-bot

# Dependencies installieren
npm install

# Umgebungsvariablen einrichten
cp .env.example .env
# Bearbeite .env mit deinen Werten

# Bot starten
npm run dev
```

## 🐳 Docker

```bash
# Image bauen und starten
docker build -t discord-bot .
docker run -d --name discord-bot -p 3001:3001 --env-file .env discord-bot
```

## 📖 Commands

- `/ticket create` - Support-Ticket erstellen
- `/embed create` - Discord Embed erstellen
- `/autoresponse add` - Automatische Antwort hinzufügen
- `/webhook add` - Webhook hinzufügen
- `/stats server` - Server-Statistiken

## 🔌 API

REST API verfügbar unter: `http://localhost:3001/api`

- `GET /api/health` - Health Check
- `GET /api/tickets` - Alle Tickets
- `GET /api/stats` - Bot-Statistiken

## 🤝 Related Projects

- **Frontend Dashboard**: [discord-dashboard](https://github.com/yourusername/discord-dashboard)
- **Documentation**: [discord-bot-docs](https://github.com/yourusername/discord-bot-docs)

## 📚 Dokumentation

Vollständige Dokumentation: [Discord Bot Docs](https://yourusername.github.io/discord-bot-docs)

## 📄 Lizenz

MIT License
