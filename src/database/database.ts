import { Pool, PoolClient } from 'pg';

export class DatabaseManager {
  private pool: Pool;

  // Getter for the connection pool (needed for session store)
  get connectionPool(): Pool {
    return this.pool;
  }

  constructor() {
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bottrapper'}`;

    console.log('🔧 Connecting to PostgreSQL...');

    this.pool = new Pool({
      connectionString,
          ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'true' 
      ? { rejectUnauthorized: false } 
      : false,
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 10000, // How long to wait when connecting a client (10 seconds)
      statement_timeout: 30000, // How long to wait for a query to complete (30 seconds)
      query_timeout: 30000, // Query timeout
      application_name: 'BotTrapper-Discord-Bot',
    });

    this.pool.on('connect', (client) => {
      console.log('✅ PostgreSQL connected successfully!');
    });

    this.pool.on('error', (err) => {
      console.error('❌ PostgreSQL pool error:', err);
      if (err.message.includes('Connection terminated')) {
        console.log('🔄 Attempting to reconnect...');
      }
    });

    this.pool.on('acquire', () => {
      console.log('🔗 PostgreSQL client acquired from pool');
    });

    // Test the connection immediately
    this.testConnection();
    
    this.initializeTables();
  }
  
  private async testConnection() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('✅ Initial PostgreSQL connection test successful');
    } catch (error) {
      console.error('❌ Initial PostgreSQL connection test failed:', error);
      throw error;
    }
  }

  private async initializeTables() {
    console.log('🔧 Initializing database...');
    let client;
    
    try {
      client = await this.pool.connect();
      console.log('✅ Database connection acquired for initialization');

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
          transcript TEXT, -- Stores the ticket transcript
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMP WITH TIME ZONE,
          guild_id TEXT
        )
      `);

      // Add transcript column if it doesn't exist (migration)
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='tickets' AND column_name='transcript'
          ) THEN
            ALTER TABLE tickets ADD COLUMN transcript TEXT;
          END IF;
        END $$;
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
          enabled_features TEXT DEFAULT '["tickets","autoresponses","statistics"]', -- JSON array
          settings TEXT DEFAULT '{}', -- JSON object for additional settings
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // User JWT tokens table for persistent authentication
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_tokens (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          jwt_token TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add access_token column if it doesn't exist (migration)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'user_tokens' AND column_name = 'access_token'
          ) THEN
            ALTER TABLE user_tokens ADD COLUMN access_token TEXT;
          END IF;
        END $$;
      `);

      // Global admin users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS global_admins (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          level INTEGER DEFAULT 1,
          granted_by TEXT,
          granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT true
        )
      `);

      // Global settings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS global_settings (
          id SERIAL PRIMARY KEY,
          setting_key TEXT NOT NULL UNIQUE,
          setting_value TEXT,
          setting_type TEXT DEFAULT 'string',
          description TEXT,
          updated_by TEXT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Admin activity log
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_activity_log (
          id SERIAL PRIMARY KEY,
          admin_user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          details TEXT,
          guild_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
      await client.query('CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON user_tokens(user_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_user_tokens_expires_at ON user_tokens(expires_at)');

      console.log('✅ Database tables initialized');
      console.log('✅ Database initialization complete');
    } catch (error) {
      console.error('❌ Error initializing PostgreSQL tables:', error);
      throw error;
    } finally {
      if (client) {
        client.release();
        console.log('🔗 Database connection released');
      }
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
  // Ticket transcript methods
  async saveTicketTranscript(ticketId: number, transcript: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE tickets SET transcript = $1 WHERE id = $2`,
        [transcript, ticketId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getTicketTranscript(ticketId: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, user_id, username, reason, transcript, created_at, closed_at 
         FROM tickets WHERE id = $1 AND guild_id = $2 AND transcript IS NOT NULL`,
        [ticketId, guildId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getTicketsWithTranscripts(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, user_id, username, reason, created_at, closed_at 
         FROM tickets 
         WHERE guild_id = $1 AND status = 'closed' AND transcript IS NOT NULL 
         ORDER BY closed_at DESC`,
        [guildId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

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
      const defaultFeatures = ['tickets', 'autoresponses', 'statistics'];
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

  // JWT Token methods
  async storeUserToken(userId: string, jwtToken: string, accessToken: string, refreshToken: string, expiresAt: Date) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO user_tokens (user_id, jwt_token, access_token, refresh_token, expires_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id) 
         DO UPDATE SET jwt_token = $2, access_token = $3, refresh_token = $4, expires_at = $5, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userId, jwtToken, accessToken, refreshToken, expiresAt]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async updateUserTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: Date) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE user_tokens 
         SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING id`,
        [userId, accessToken, refreshToken, expiresAt]
      );
      return result.rows[0]?.id || null;
    } finally {
      client.release();
    }
  }

  async getUserToken(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT jwt_token, access_token, refresh_token, expires_at FROM user_tokens 
         WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP`,
        [userId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async removeUserToken(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM user_tokens WHERE user_id = $1`,
        [userId]
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async cleanExpiredTokens() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM user_tokens WHERE expires_at <= CURRENT_TIMESTAMP`
      );
      console.log(`🧹 Cleaned ${result.rowCount} expired tokens`);
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Global Admin methods
  async addGlobalAdmin(userId: string, username: string, level: number = 1, grantedBy: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO global_admins (user_id, username, level, granted_by) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (user_id) 
         DO UPDATE SET username = $2, level = $3, granted_by = $4, granted_at = CURRENT_TIMESTAMP, is_active = true
         RETURNING id`,
        [userId, username, level, grantedBy]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async removeGlobalAdmin(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE global_admins SET is_active = false WHERE user_id = $1`,
        [userId]
      );
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async isGlobalAdmin(userId: string): Promise<{ isAdmin: boolean; level: number }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT level FROM global_admins WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      if (result.rows.length > 0) {
        return { isAdmin: true, level: result.rows[0].level };
      }
      return { isAdmin: false, level: 0 };
    } finally {
      client.release();
    }
  }

  async getAllGlobalAdmins() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM global_admins WHERE is_active = true ORDER BY level DESC, granted_at DESC`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Global Settings methods
  async setGlobalSetting(key: string, value: string, type: string = 'string', description: string = '', updatedBy: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO global_settings (setting_key, setting_value, setting_type, description, updated_by) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (setting_key) 
         DO UPDATE SET setting_value = $2, setting_type = $3, description = $4, updated_by = $5, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [key, value, type, description, updatedBy]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getGlobalSetting(key: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM global_settings WHERE setting_key = $1`,
        [key]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getAllGlobalSettings() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM global_settings ORDER BY setting_key ASC`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Admin Activity Log
  async logAdminActivity(adminUserId: string, action: string, targetType?: string, targetId?: string, details?: string, guildId?: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO admin_activity_log (admin_user_id, action, target_type, target_id, details, guild_id) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [adminUserId, action, targetType || null, targetId || null, details || null, guildId || null]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getAdminActivityLog(limit: number = 50) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT al.*, ga.username as admin_username 
         FROM admin_activity_log al 
         LEFT JOIN global_admins ga ON al.admin_user_id = ga.user_id 
         ORDER BY al.created_at DESC 
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Admin Guilds method - Get all guilds that have any bot activity
  async getAllGuilds(): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      // Get all unique guild_ids from various tables (avoiding autoresponses table that doesn't exist)
      const result = await client.query(`
        SELECT DISTINCT guild_id 
        FROM (
          SELECT guild_id FROM guild_settings 
          UNION 
          SELECT guild_id FROM guild_permissions
          UNION 
          SELECT guild_id FROM tickets
          UNION 
          SELECT guild_id FROM dscp_permissions
        ) AS all_guilds 
        WHERE guild_id IS NOT NULL
        ORDER BY guild_id
      `);
      
      return result.rows.map(row => row.guild_id);
    } catch (error) {
      console.error('Get all guilds error:', error);
      return [];
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
