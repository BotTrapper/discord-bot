import axios from 'axios';
import { dbManager } from '../database/database.js';

interface WebhookData {
  content?: string;
  embeds?: any[];
  username?: string;
  avatar_url?: string;
}

export class WebhookNotification {
  private static webhookUrls: Map<string, string> = new Map();

  // Load webhooks from database into memory cache
  static async loadWebhooks(guildId: string) {
    try {
      const webhooks = await dbManager.getWebhooks(guildId) as any[];
      webhooks.forEach(webhook => {
        this.webhookUrls.set(webhook.name, webhook.url);
      });
      console.log(`✅ Loaded ${webhooks.length} webhooks for guild ${guildId}`);
    } catch (error) {
      console.error('Error loading webhooks:', error);
    }
  }

  static async addWebhook(name: string, url: string, guildId: string) {
    try {
      await dbManager.addWebhook(name, url, guildId);
      this.webhookUrls.set(name, url);
      return true;
    } catch (error) {
      console.error('Error adding webhook:', error);
      return false;
    }
  }

  static removeWebhook(name: string) {
    this.webhookUrls.delete(name);
  }

  static async sendNotification(webhookName: string, data: WebhookData) {
    const url = this.webhookUrls.get(webhookName);
    if (!url) {
      console.log(`⚠️ Webhook "${webhookName}" nicht konfiguriert - Überspringe Notification`);
      return false; // Nicht mehr werfen, sondern graceful handling
    }

    try {
      await axios.post(url, data);
      console.log(`✅ Webhook "${webhookName}" erfolgreich gesendet`);
      return true;
    } catch (error) {
      console.error(`❌ Fehler beim Senden der Webhook-Nachricht "${webhookName}":`, error);
      return false;
    }
  }

  static async sendTicketNotification(webhookName: string, ticketData: {
    user: string;
    reason: string;
    channelName: string;
    action: 'created' | 'closed';
  }) {
    const embed = {
      title: ticketData.action === 'created' ? '🎫 Neues Ticket erstellt' : '🔒 Ticket geschlossen',
      fields: [
        { name: 'Benutzer', value: ticketData.user, inline: true },
        { name: 'Grund', value: ticketData.reason, inline: true },
        { name: 'Kanal', value: ticketData.channelName, inline: true }
      ],
      color: ticketData.action === 'created' ? 0x00AE86 : 0xFF0000,
      timestamp: new Date().toISOString()
    };

    return this.sendNotification(webhookName, { embeds: [embed] });
  }

  static getWebhooks() {
    return Array.from(this.webhookUrls.entries());
  }
}
