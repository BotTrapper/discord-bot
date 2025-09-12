import { Pool, PoolClient } from 'pg';

export class DatabaseManager {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bottrapper'}`;

    console.log('🔧 Connecting to PostgreSQL...');

    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 2000, // How long to wait when connecting a client
    });

    this.pool.on('connect', () => {
      console.log('✅ PostgreSQL connected successfully!');
    });

    this.pool.on('error', (err) => {
      console.error('❌ PostgreSQL connection error:', err);
    });

    this.initializeTables();
  }

  private async initializeTables() {
    const client = await this.pool.connect();

    try {
      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Tickets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS tickets (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          channel_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMP WITH TIME ZONE,
          guild_id TEXT
        )
      `);

      // Auto responses table
      await client.query(`
        CREATE TABLE IF NOT EXISTS auto_responses (
          id SERIAL PRIMARY KEY,
          trigger_word TEXT NOT NULL,
          response_text TEXT NOT NULL,
          is_embed BOOLEAN DEFAULT FALSE,
          embed_title TEXT,
          embed_description TEXT,
          embed_color INTEGER,
          guild_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(trigger_word, guild_id)
        )
      `);

      // Webhooks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          guild_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, guild_id)
        )
      `);

      // Bot statistics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS bot_stats (
          id SERIAL PRIMARY KEY,
          command_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          guild_id TEXT,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // User permissions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_permissions (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          role TEXT NOT NULL,
          permissions TEXT, -- JSON string of permissions
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, guild_id)
        )
      `);

      // DSCP Permissions table for fine-grained access control
      await client.query(`
        CREATE TABLE IF NOT EXISTS dscp_permissions (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          type TEXT NOT NULL, -- 'user' or 'role'
          target_id TEXT NOT NULL, -- user_id or role_id
          target_name TEXT NOT NULL, -- username or role name for display
          permissions TEXT NOT NULL, -- JSON array of permissions
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guild_id, type, target_id)
        )
      `);

      // Guild settings table for feature management
      await client.query(`
        CREATE TABLE IF NOT EXISTS guild_settings (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL UNIQUE,
          enabled_features TEXT DEFAULT '["tickets","autoresponses","statistics","webhooks"]', -- JSON array
          settings TEXT DEFAULT '{}', -- JSON object for additional settings
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for better performance
      await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_guild_id ON tickets(guild_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_auto_responses_guild_id ON auto_responses(guild_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_bot_stats_guild_id ON bot_stats(guild_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_bot_stats_executed_at ON bot_stats(executed_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_dscp_permissions_guild_id ON dscp_permissions(guild_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_webhooks_guild_id ON webhooks(guild_id)');

      console.log('✅ PostgreSQL tables initialized successfully!');
    } catch (error) {
      console.error('❌ Error initializing PostgreSQL tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Ticket methods
  async createTicket(ticketData: {
    userId: string;
    username: string;
    reason: string;
    channelId: string;
    guildId: string;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO tickets (user_id, username, reason, channel_id, guild_id) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ticketData.userId, ticketData.username, ticketData.reason, ticketData.channelId, ticketData.guildId]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async closeTicket(ticketId: number) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [ticketId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async deleteTicket(ticketId: number) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM tickets WHERE id = $1`,
        [ticketId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getTicketById(ticketId: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM tickets WHERE id = $1 AND guild_id = $2`,
        [ticketId, guildId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getTickets(guildId: string, status?: string) {
    const client = await this.pool.connect();
    try {
      let query = `SELECT * FROM tickets WHERE guild_id = $1`;
      const params = [guildId];

      if (status) {
        query += ` AND status = $2`;
        params.push(status);
      }

      query += ` ORDER BY created_at DESC`;

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getTicketCount(guildId: string, status?: string) {
    const client = await this.pool.connect();
    try {
      let query = `SELECT COUNT(*) as count FROM tickets WHERE guild_id = $1`;
      const params = [guildId];

      if (status) {
        query += ` AND status = $2`;
        params.push(status);
      }

      const result = await client.query(query, params);
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO auto_responses (trigger_word, response_text, is_embed, embed_title, embed_description, embed_color, guild_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         ON CONFLICT (trigger_word, guild_id) DO NOTHING
         RETURNING id`,
        [responseData.trigger, responseData.response, responseData.isEmbed,
         responseData.embedTitle, responseData.embedDescription, responseData.embedColor, responseData.guildId]
      );
      return result.rows[0]?.id || null;
    } finally {
      client.release();
    }
  }

  async removeAutoResponse(trigger: string, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM auto_responses WHERE trigger_word = $1 AND guild_id = $2`,
        [trigger, guildId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getAutoResponses(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM auto_responses WHERE guild_id = $1 ORDER BY created_at DESC`,
        [guildId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getAutoResponseCount(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM auto_responses WHERE guild_id = $1`,
        [guildId]
      );
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // Statistics methods
  async logCommand(commandName: string, userId: string, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO bot_stats (command_name, user_id, guild_id) VALUES ($1, $2, $3) RETURNING id`,
        [commandName, userId, guildId]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getCommandStats(guildId: string, days: number = 30) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT command_name, COUNT(*) as usage_count 
         FROM bot_stats 
         WHERE guild_id = $1 AND executed_at >= NOW() - INTERVAL '${days} days'
         GROUP BY command_name 
         ORDER BY usage_count DESC`,
        [guildId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Webhook methods
  async addWebhook(name: string, url: string, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO webhooks (name, url, guild_id) VALUES ($1, $2, $3) RETURNING id`,
        [name, url, guildId]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getWebhooks(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM webhooks WHERE guild_id = $1 ORDER BY created_at DESC`,
        [guildId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async removeWebhook(name: string, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM webhooks WHERE name = $1 AND guild_id = $2`,
        [name, guildId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Permission methods
  async setUserPermissions(userId: string, guildId: string, role: string, permissions: string[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO user_permissions (user_id, guild_id, role, permissions) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (user_id, guild_id) 
         DO UPDATE SET role = $3, permissions = $4, created_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userId, guildId, role, JSON.stringify(permissions)]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getUserPermissions(userId: string, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM user_permissions WHERE user_id = $1 AND guild_id = $2`,
        [userId, guildId]
      );
      const row = result.rows[0];
      if (row) {
        row.permissions = JSON.parse(row.permissions || '[]');
      }
      return row || null;
    } finally {
      client.release();
    }
  }

  // DSCP Permission methods
  async addDSCPPermission(permissionData: {
    guildId: string;
    type: 'user' | 'role';
    targetId: string;
    targetName: string;
    permissions: string[];
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO dscp_permissions (guild_id, type, target_id, target_name, permissions) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (guild_id, type, target_id) 
         DO UPDATE SET target_name = $4, permissions = $5, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [permissionData.guildId, permissionData.type, permissionData.targetId,
         permissionData.targetName, JSON.stringify(permissionData.permissions)]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getDSCPPermissions(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM dscp_permissions WHERE guild_id = $1 ORDER BY created_at DESC`,
        [guildId]
      );
      return result.rows.map(row => ({
        ...row,
        permissions: JSON.parse(row.permissions)
      }));
    } finally {
      client.release();
    }
  }

  async removeDSCPPermission(id: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM dscp_permissions WHERE id = $1 AND guild_id = $2`,
        [id, guildId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Guild settings methods
  async getGuildSettings(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM guild_settings WHERE guild_id = $1`,
        [guildId]
      );
      const row = result.rows[0];
      if (row) {
        return {
          ...row,
          enabled_features: JSON.parse(row.enabled_features || '[]'),
          settings: JSON.parse(row.settings || '{}')
        };
      }

      // If no settings exist, create default settings and save to database
      const defaultFeatures = ['tickets', 'autoresponses', 'statistics', 'webhooks'];
      const defaultSettings = {};

      // Insert the default settings directly within this connection
      const insertResult = await client.query(
        `INSERT INTO guild_settings (guild_id, enabled_features, settings) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [guildId, JSON.stringify(defaultFeatures), JSON.stringify(defaultSettings)]
      );

      const newRow = insertResult.rows[0];
      return {
        ...newRow,
        enabled_features: JSON.parse(newRow.enabled_features || '[]'),
        settings: JSON.parse(newRow.settings || '{}')
      };
    } finally {
      client.release();
    }
  }

  async updateGuildSettings(guildId: string, enabledFeatures: string[], settings: any = {}) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO guild_settings (guild_id, enabled_features, settings) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (guild_id) 
         DO UPDATE SET enabled_features = $2, settings = $3, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [guildId, JSON.stringify(enabledFeatures), JSON.stringify(settings)]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // Close all connections
  async close() {
    await this.pool.end();
    console.log('🔒 PostgreSQL connection pool closed');
  }
}

// Export singleton instance
export const dbManager = new DatabaseManager();
