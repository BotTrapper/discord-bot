# Discord Bot - TypeScript

[![CI/CD Pipeline](https://github.com/BotTrapper/discord-bot/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/ci-cd.yml)
[![Docker Build](https://github.com/BotTrapper/discord-bot/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/docker-publish.yml)
[![Dependency Check](https://github.com/BotTrapper/discord-bot/actions/workflows/dependency-check.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/dependency-check.yml)

🤖 Ein vollständiger Discord Bot mit TypeScript, SQLite und Express API.

## 🚀 Features

- **Slash Commands**: Moderne Discord-Interaktionen
- **Ticket System**: Automatisierte Support-Tickets mit kompletter Persistierung
- **Embed Builder**: Schöne Discord-Nachrichten erstellen
- **Auto Response**: Automatische Antworten auf Nachrichten (persistent)
- **Webhook Notifications**: Externe Benachrichtigungen (persistent)
- **Permission System**: Erweiterte Benutzerberechtigungen (persistent)
- **REST API**: Vollständige API für Frontend-Integration
- **SQLite Database**: Vollständige Persistierung aller Bot-Daten
- **🔄 Restart-Safe**: Alle Einstellungen bleiben nach Bot-Neustart erhalten

## � CI/CD Pipeline

Dieses Projekt verwendet GitHub Actions für automatisierte Tests und Deployment:

- ✅ **Automated Testing**: TypeScript Build, Type-Checking, Integration Tests
- ✅ **Docker Build**: Multi-Stage Docker Build mit Optimierungen  
- ✅ **Security Checks**: NPM Audit, Secrets Scanning
- ✅ **Database Testing**: SQLite Initialisierung und Connection Tests
- ✅ **Multi-Node Support**: Tests mit Node.js 18.x und 20.x
- ✅ **Deployment Ready**: Automatische Deployment-Artefakte für Production

### Quick Commands

```bash
# Development
npm run dev

# Build & Test
npm run build
npm test
npm run type-check

# Docker (local)
docker build -t discord-bot .
docker-compose up -d
```

📖 **Vollständige CI/CD Dokumentation**: [.github/CI-CD-README.md](.github/CI-CD-README.md)

## �💾 Persistierung

Der Bot speichert **alle** wichtigen Daten persistent in einer SQLite-Datenbank:

- ✅ **Auto-Responses**: Automatische Antworten bleiben nach Neustart erhalten
- ✅ **Webhooks**: Webhook-Konfigurationen werden automatisch geladen
- ✅ **Tickets**: Vollständige Ticket-Historie und Status
- ✅ **User-Permissions**: Benutzerdefinierte Berechtigungen
- ✅ **Bot-Statistiken**: Command-Usage und Analytics
- ✅ **Guild-Settings**: Alle Server-spezifischen Einstellungen

### Automatische Initialisierung

Beim ersten Start werden Standard-Einstellungen automatisch erstellt:
- Standard Auto-Response für "hallo", "help", "danke"  
- Leere Webhook- und Permissions-Tabellen
- Vollständige Datenbankstruktur

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
