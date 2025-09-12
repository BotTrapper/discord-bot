# 🚀 SQLite zu PostgreSQL Migration Guide

## Übersicht
Diese Anleitung führt Sie durch die Migration Ihrer BotTrapper Discord Bot Datenbank von SQLite zu PostgreSQL für bessere Skalierbarkeit und Performance.

## Was wurde geändert

### ✅ Neue Dateien erstellt:
- `src/database/database-postgres.ts` - Neue PostgreSQL Implementierung 
- `src/database/migration.ts` - Migrationsskript für Datenübertragung
- `docker-compose.postgres.yml` - PostgreSQL Container Setup
- `.env.example` - Beispiel-Umgebungsvariablen

### ✅ Aktualisierte Dateien:
- `src/database/database.ts` - Komplett auf PostgreSQL umgestellt
- `package.json` - Migration Scripts hinzugefügt
- `src/features/permissionManager.ts` - PostgreSQL Kompatibilität

## 🛠️ Migrations-Schritte

### 1. PostgreSQL Setup

#### Option A: Docker (Empfohlen)
```bash
# PostgreSQL Container starten
npm run db:setup

# Überprüfen ob Container läuft
docker ps
```

#### Option B: Lokale PostgreSQL Installation
Installieren Sie PostgreSQL auf Ihrem System und erstellen Sie eine Datenbank namens `bottrapper`.

### 2. Umgebungsvariablen konfigurieren

Kopieren Sie `.env.example` zu `.env` und passen Sie die Werte an:

```env
# PostgreSQL Verbindung
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bottrapper
DB_USER=postgres
DB_PASSWORD=your_password_here

# Oder verwenden Sie eine komplette Connection String:
# DATABASE_URL=postgresql://postgres:password@localhost:5432/bottrapper

# Für Migration: Pfad zur alten SQLite Datei
SQLITE_DATABASE_PATH=./data/bot.db
```

### 3. Daten migrieren

```bash
# Alle existierenden Daten von SQLite zu PostgreSQL übertragen
npm run db:migrate
```

### 4. Bot neu starten

```bash
# Bot mit PostgreSQL starten
npm run dev
```

## 🔧 Verfügbare Scripts

```bash
# PostgreSQL Container starten
npm run db:setup

# Daten von SQLite zu PostgreSQL migrieren
npm run db:migrate

# PostgreSQL Container stoppen
npm run db:stop

# Bot entwickeln
npm run dev
```

## 📊 Verbesserungen durch PostgreSQL

### Performance
- **Bessere Concurrent Access**: Mehrere gleichzeitige Verbindungen ohne Blocking
- **Connection Pooling**: Effiziente Verbindungsverwaltung (max 20 Connections)
- **Optimierte Queries**: PostgreSQL-spezifische Optimierungen
- **Indizes**: Automatische Indizes für bessere Query-Performance

### Skalierbarkeit
- **Größere Datenmengen**: Keine Dateigröße-Limitierungen wie bei SQLite
- **Multi-Guild Support**: Bessere Performance bei vielen Discord Servern
- **Horizontale Skalierung**: Möglichkeit für Read-Replicas

### Features
- **JSON Support**: Native JSON Spalten für komplexe Datenstrukturen
- **Timestamps**: Timezone-aware Timestamps
- **UPSERT**: Effiziente INSERT OR UPDATE Operationen
- **Transaktionen**: Bessere Datenintegrität

## 🔍 Datenbank Schema

### Haupttabellen:
1. **tickets** - Ticket System Daten
2. **auto_responses** - Automatische Antworten
3. **webhooks** - Webhook Konfigurationen
4. **bot_stats** - Command Statistiken
5. **user_permissions** - Benutzerberechtigung
6. **dscp_permissions** - Detaillierte Dashboard Berechtigungen
7. **guild_settings** - Guild-spezifische Einstellungen

### Wichtige Verbesserungen:
- **SERIAL** statt AUTOINCREMENT für IDs
- **TIMESTAMP WITH TIME ZONE** für bessere Zeitzone-Unterstützung
- **UNIQUE Constraints** mit Multiple-Column Support
- **Automatische Indizes** für bessere Query Performance

## 🚨 Troubleshooting

### Connection Errors
```bash
# Container Logs prüfen
docker logs bottrapper-postgres

# Connection testen
docker exec -it bottrapper-postgres psql -U postgres -d bottrapper
```

### Migration Probleme
```bash
# Migration mit Debug-Output
DEBUG=* npm run db:migrate
```

### Rollback (falls nötig)
Falls Sie zur SQLite zurückkehren möchten, sichern Sie einfach Ihre alte `data/bot.db` und ändern Sie in der `.env`:
```env
# Verwenden Sie die alte SQLite Implementation
DATABASE_URL=
```

## 🔐 Produktions-Deployment

Für Produktion verwenden Sie hosted PostgreSQL Services wie:
- **Heroku Postgres**
- **Railway PostgreSQL**
- **DigitalOcean Managed Databases**
- **AWS RDS PostgreSQL**

Connection String Format:
```
DATABASE_URL=postgresql://username:password@hostname:5432/database?sslmode=require
```

## 📈 Monitoring

Mit PostgreSQL können Sie erweiterte Monitoring-Tools verwenden:
- **PgAdmin** (bereits im Docker Setup enthalten auf Port 8080)
- **pg_stat_statements** für Query-Performance
- **Built-in PostgreSQL Logs**

## ✅ Nach der Migration

1. Testen Sie alle Bot-Features gründlich
2. Überwachen Sie die Performance 
3. Sichern Sie regelmäßig Ihre PostgreSQL Datenbank
4. Löschen Sie die alte SQLite Datei nur nach erfolgreicher Verifikation

Die Migration ist jetzt abgeschlossen! Ihr Bot sollte deutlich bessere Performance bei wachsender Nutzerzahl zeigen.
