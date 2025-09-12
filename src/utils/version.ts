import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface VersionInfo {
  version: string;
  name: string;
  description: string;
  startTime: Date;
}

class VersionManager {
  private versionInfo: VersionInfo;

  constructor() {
    this.versionInfo = this.loadVersionInfo();
  }

  private loadVersionInfo(): VersionInfo {
    try {
      const packagePath = join(__dirname, '../../package.json');
      const packageContent = readFileSync(packagePath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      return {
        version: packageJson.version || '1.0.0',
        name: packageJson.name || 'discord_bot',
        description: packageJson.description || 'BotTrapper Discord Bot',
        startTime: new Date()
      };
    } catch (error) {
      console.error('Error loading version info:', error);
      return {
        version: '1.0.0',
        name: 'discord_bot',
        description: 'BotTrapper Discord Bot',
        startTime: new Date()
      };
    }
  }

  public getVersion(): string {
    return this.versionInfo.version;
  }

  public getVersionInfo(): VersionInfo {
    return { ...this.versionInfo };
  }

  public getFullVersionString(): string {
    return `${this.versionInfo.name} v${this.versionInfo.version}`;
  }

  public getUptimeString(): string {
    const now = new Date();
    const uptime = now.getTime() - this.versionInfo.startTime.getTime();
    
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export singleton instance
export const versionManager = new VersionManager();