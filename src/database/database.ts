import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';

export class DatabaseManager {
  private db: Database;

  constructor() {
    const dbPath = process.env.DATABASE_PATH || './data/bot.db';
    this.db = new sqlite3.Database(dbPath);
    this.initializeTables();
  }

  private initializeTables() {
    // Tickets table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        guild_id TEXT
      )
    `);

    // Auto responses table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_word TEXT NOT NULL UNIQUE,
        response_text TEXT NOT NULL,
        is_embed BOOLEAN DEFAULT FALSE,
        embed_title TEXT,
        embed_description TEXT,
        embed_color INTEGER,
        guild_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Webhooks table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        guild_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bot statistics table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS bot_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User permissions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions TEXT, -- JSON string of permissions
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, guild_id)
      )
    `);
  }

  // Ticket methods
  async createTicket(ticketData: {
    userId: string;
    username: string;
    reason: string;
    channelId: string;
    guildId: string;
  }) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO tickets (user_id, username, reason, channel_id, guild_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [ticketData.userId, ticketData.username, ticketData.reason, ticketData.channelId, ticketData.guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async closeTicket(ticketId: number) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [ticketId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async getTickets(guildId: string, status?: string) {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM tickets WHERE guild_id = ?`;
      const params = [guildId];
      
      if (status) {
        query += ` AND status = ?`;
        params.push(status);
      }
      
      query += ` ORDER BY created_at DESC`;

      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Auto response methods
  async addAutoResponse(responseData: {
    trigger: string;
    response: string;
    isEmbed: boolean;
    embedTitle?: string;
    embedDescription?: string;
    embedColor?: number;
    guildId: string;
  }) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO auto_responses (trigger_word, response_text, is_embed, embed_title, embed_description, embed_color, guild_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [responseData.trigger, responseData.response, responseData.isEmbed, 
         responseData.embedTitle, responseData.embedDescription, responseData.embedColor, responseData.guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async removeAutoResponse(trigger: string, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM auto_responses WHERE trigger_word = ? AND guild_id = ?`,
        [trigger, guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async getAutoResponses(guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM auto_responses WHERE guild_id = ? ORDER BY created_at DESC`,
        [guildId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Statistics methods
  async logCommand(commandName: string, userId: string, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO bot_stats (command_name, user_id, guild_id) VALUES (?, ?, ?)`,
        [commandName, userId, guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getCommandStats(guildId: string, days: number = 30) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT command_name, COUNT(*) as usage_count 
         FROM bot_stats 
         WHERE guild_id = ? AND executed_at >= datetime('now', '-${days} days')
         GROUP BY command_name 
         ORDER BY usage_count DESC`,
        [guildId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Webhook methods
  async addWebhook(name: string, url: string, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO webhooks (name, url, guild_id) VALUES (?, ?, ?)`,
        [name, url, guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getWebhooks(guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM webhooks WHERE guild_id = ?`,
        [guildId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async removeWebhook(name: string, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM webhooks WHERE name = ? AND guild_id = ?`,
        [name, guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // User permissions methods
  async setUserPermissions(userId: string, guildId: string, role: string, permissions: any) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO user_permissions (user_id, guild_id, role, permissions) 
         VALUES (?, ?, ?, ?)`,
        [userId, guildId, role, JSON.stringify(permissions)],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getUserPermissions(userId: string, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM user_permissions WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getAllUserPermissions(guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_permissions WHERE guild_id = ?`,
        [guildId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  close() {
    this.db.close();
  }
}

export const dbManager = new DatabaseManager();
