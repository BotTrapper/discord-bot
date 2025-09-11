import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import path from 'path';
import fs from 'fs';

export class DatabaseManager {
  private db: Database;

  constructor() {
    const dbPath = process.env.DATABASE_PATH || './data/bot.db';
    console.log('🔧 Database path:', dbPath);
    
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      console.log('📁 Creating database directory:', dbDir);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    console.log('🗄️ Opening SQLite database...');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database connection failed:', err);
      } else {
        console.log('✅ Database connected successfully!');
      }
    });
    
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

    // DSCP Permissions table for fine-grained access control
    this.db.run(`
      CREATE TABLE IF NOT EXISTS dscp_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'user' or 'role'
        target_id TEXT NOT NULL, -- user_id or role_id
        target_name TEXT NOT NULL, -- username or role name for display
        permissions TEXT NOT NULL, -- JSON array of permissions
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, type, target_id)
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

  async deleteTicket(ticketId: number) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM tickets WHERE id = ?`,
        [ticketId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async getTicketById(ticketId: number, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM tickets WHERE id = ? AND guild_id = ?`,
        [ticketId, guildId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
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
        `INSERT OR IGNORE INTO auto_responses (trigger_word, response_text, is_embed, embed_title, embed_description, embed_color, guild_id) 
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
        `INSERT OR REPLACE INTO user_permissions (user_id, guild_id, role, permissions) VALUES (?, ?, ?, ?)`,
        [userId, guildId, role, JSON.stringify(permissions)],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  // DSCP Permissions methods
  async getDSCPPermissions(guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM dscp_permissions WHERE guild_id = ? ORDER BY created_at DESC`,
        [guildId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else {
            // Parse JSON permissions for each row
            const parsedRows = rows.map(row => ({
              ...row,
              permissions: JSON.parse(row.permissions)
            }));
            resolve(parsedRows);
          }
        }
      );
    });
  }

  async addDSCPPermission(permissionData: {
    guildId: string;
    type: string;
    targetId: string;
    targetName: string;
    permissions: string[];
  }) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO dscp_permissions (guild_id, type, target_id, target_name, permissions, updated_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          permissionData.guildId,
          permissionData.type,
          permissionData.targetId,
          permissionData.targetName,
          JSON.stringify(permissionData.permissions)
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async removeDSCPPermission(id: number, guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM dscp_permissions WHERE id = ? AND guild_id = ?`,
        [id, guildId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async checkDSCPPermission(userId: string, guildId: string, permission: string) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT permissions FROM dscp_permissions 
         WHERE guild_id = ? AND type = 'user' AND target_id = ?`,
        [guildId, userId],
        (err, row: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            resolve(false);
            return;
          }

          try {
            const permissions = JSON.parse(row.permissions);
            resolve(permissions.includes(permission) || permissions.includes('*'));
          } catch (parseErr) {
            reject(parseErr);
          }
        }
      );
    });
  }

  // Dashboard-specific methods
  async getTicketCount(guildId: string, status?: string) {
    return new Promise((resolve, reject) => {
      let query = `SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?`;
      const params = [guildId];

      if (status) {
        query += ` AND status = ?`;
        params.push(status);
      }

      this.db.get(query, params, (err, row: any) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    });
  }

  async getAutoResponseCount(guildId: string) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM auto_responses WHERE guild_id = ?`,
        [guildId],
        (err, row: any) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        }
      );
    });
  }

  async getRecentActivity(guildId: string, limit: number = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 'ticket' as type, 'Ticket created: ' || reason as description, created_at as timestamp
         FROM tickets WHERE guild_id = ?
         UNION ALL
         SELECT 'autoresponse' as type, 'Auto-response added: ' || trigger_word as description, created_at as timestamp
         FROM auto_responses WHERE guild_id = ?
         UNION ALL
         SELECT 'command' as type, 'Command used: ' || command_name as description, executed_at as timestamp
         FROM bot_stats WHERE guild_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [guildId, guildId, guildId, limit],
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
