# 🚀 CI/CD Pipeline Documentation

## GitHub Actions Workflows

Dieses Projekt verwendet mehrere GitHub Actions Workflows für automatisierte Tests und Deployment.

### 🔄 Haupt-Pipeline: `ci-cd.yml`

**Trigger:**
- Push auf `main` oder `develop` Branch
- Pull Requests nach `main`

**Jobs:**

#### 1. **Test** 
- Testet mit Node.js 18.x und 20.x
- TypeScript Build
- Type-Checking
- Upload von Build-Artefakten

#### 2. **Lint**
- Code-Qualitätschecks
- Suche nach häufigen Problemen

#### 3. **Docker Build**
- Docker Image Build-Test
- Docker Compose Validierung
- Image-Funktionalitätstests

#### 4. **Security**
- NPM Security Audit
- Secrets-Scanning im Code

#### 5. **Database Test**
- SQLite Database Initialisierung
- Database Connection Tests

#### 6. **Integration Test**
- End-to-End Funktionalitätstests
- Bot Initialisierung (Dry Run)

#### 7. **Deployment Ready**
- Nur für `main` Branch
- Erstellt Deployment-Artefakt
- Validiert komplette Pipeline

### 🐳 Docker Pipeline: `docker-publish.yml`

**Trigger:**
- Git Tags (v*)
- Releases
- Manueller Workflow-Trigger

**Features:**
- Multi-Architektur Build (AMD64, ARM64)
- GitHub Container Registry Publishing
- Automatische Version-Tags
- Build-Cache Optimierung

### 🔍 Dependency Check: `dependency-check.yml`

**Trigger:**
- Wöchentlich (Montags um 2:00 Uhr)
- Manueller Trigger

**Features:**
- Outdated Dependencies Check
- Security Vulnerabilities Scan
- Discord.js Kompatibilitätsprüfung
- Automatische Reports

## 🛠️ Lokale Entwicklung

### Build-Scripts

```bash
# Standard Build
npm run build

# Type-Checking ohne Build
npm run type-check

# Watch-Mode für Development
npm run build:watch

# Cleaning
npm run clean
```

### Test-Scripts

```bash
# Alle Tests
npm test

# Unit Tests
npm run test:unit

# Integration Tests
npm run test:integration

# Docker Build Test
npm run test:docker

# Security Check
npm run security-check
```

## 🚀 Deployment

### Automatisches Deployment

1. **Development**: Push auf `develop` → Alle Tests laufen
2. **Staging**: Pull Request nach `main` → Vollständige Pipeline
3. **Production**: Merge nach `main` → Deployment-Ready Artefakt

### Manuelles Deployment

```bash
# 1. Build erstellen
npm run build

# 2. Docker Image bauen
docker build -t discord-bot .

# 3. Mit Docker Compose starten
docker-compose up -d
```

### Release Process

1. Version in `package.json` erhöhen
2. Git Tag erstellen: `git tag v1.0.0`
3. Tag pushen: `git push origin v1.0.0`
4. Automatischer Docker Build und Publishing

## 📊 Status Badges

Fügen Sie diese Badges zu Ihrer README hinzu:

```markdown
[![CI/CD Pipeline](https://github.com/BotTrapper/discord-bot/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/ci-cd.yml)
[![Docker Build](https://github.com/BotTrapper/discord-bot/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/docker-publish.yml)
[![Dependency Check](https://github.com/BotTrapper/discord-bot/actions/workflows/dependency-check.yml/badge.svg)](https://github.com/BotTrapper/discord-bot/actions/workflows/dependency-check.yml)
```

## 🔧 Konfiguration

### Environment Variables für CI/CD

```bash
# Secrets in GitHub Repository Settings hinzufügen:
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id
```

### Docker Registry

Das Projekt ist konfiguriert für GitHub Container Registry (ghcr.io).
Images werden automatisch gepublisht bei Tags und Releases.

## 🐛 Troubleshooting

### Common CI/CD Issues

#### Docker Compose Command Not Found
```bash
# GitHub Actions might not have docker-compose installed
# The pipeline handles this automatically with fallbacks:
# 1. Try "docker compose" (modern)
# 2. Try "docker-compose" (legacy) 
# 3. Fall back to YAML syntax validation
```

#### Build Failures

```bash
# Lokal testen
npm run type-check
npm run build
npm run test:docker
```

#### Docker Issues

```bash
# Image lokal bauen und testen
docker build -t discord-bot:test .
docker run --rm discord-bot:test node --version
```

#### Dependencies

```bash
# Security Audit
npm audit
npm audit fix

# Outdated Packages
npm outdated
```

## 📝 Contributing

1. Fork des Repositories
2. Feature Branch erstellen
3. Änderungen committen
4. Push auf Feature Branch
5. Pull Request erstellen

Die CI/CD Pipeline wird automatisch alle Tests ausführen! ✅
