import { Pool, PoolClient } from "pg";

export class DatabaseManager {
  private pool: Pool;
  private adminCache = new Map<
    string,
    { isAdmin: boolean; level: number; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  // Getter for the connection pool (needed for session store)
  get connectionPool(): Pool {
    return this.pool;
  }

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "password"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || "bottrapper"}`;

    console.log("🔧 Connecting to PostgreSQL...");

    this.pool = new Pool({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production" && process.env.DB_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
      max: 20, // Increased connection pool size
      min: 2, // Keep minimum connections open
      idleTimeoutMillis: 10000, // Reduced idle timeout
      connectionTimeoutMillis: 2000, // Reduced connection timeout (2 seconds)
      statement_timeout: 5000, // Reduced query timeout (5 seconds)
      query_timeout: 5000, // Reduced query timeout (5 seconds)
      application_name: "BotTrapper-Discord-Bot",
    });

    this.pool.on("connect", (client) => {
      console.log("✅ PostgreSQL connected successfully!");
    });

    this.pool.on("error", (err) => {
      console.error("❌ PostgreSQL pool error:", err);
      if (err.message.includes("Connection terminated")) {
        console.log("🔄 Attempting to reconnect...");
      }
    });

    // Remove excessive logging for production performance
    if (process.env.NODE_ENV !== "production") {
      this.pool.on("acquire", () => {
        console.log("🔗 PostgreSQL client acquired from pool");
      });
    }

    // Test the connection immediately
    this.testConnection();

    this.initializeTables();
  }

  private async testConnection() {
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("✅ Initial PostgreSQL connection test successful");
    } catch (error) {
      console.error("❌ Initial PostgreSQL connection test failed:", error);
      throw error;
    }
  }

  private async initializeTables() {
    console.log("🔧 Initializing database...");
    let client;

    try {
      client = await this.pool.connect();
      console.log("✅ Database connection acquired for initialization");

      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Ticket categories table for guild-specific ticket categories (MUST be created BEFORE tickets table for foreign key)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ticket_categories (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          emoji TEXT,
          color TEXT DEFAULT '#5865F2',
          is_active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guild_id, name)
        )
      `);

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

      // Add category_id column if it doesn't exist (migration for ticket categories)
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='tickets' AND column_name='category_id'
          ) THEN
            ALTER TABLE tickets ADD COLUMN category_id INTEGER REFERENCES ticket_categories(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      // Add notification fields to guild_settings if they don't exist (migration for notification system)
      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='notification_category_id'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN notification_category_id TEXT;
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='info_channel_id'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN info_channel_id TEXT;
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='notification_roles'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN notification_roles TEXT DEFAULT '[]'; -- JSON array of role IDs
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='notifications_enabled'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN notifications_enabled BOOLEAN DEFAULT true;
          END IF;
        END $$;

        -- Add notifications_setup_completed column
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='notifications_setup_completed'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN notifications_setup_completed BOOLEAN DEFAULT false;
          END IF;
        END $$;

        -- Add last_notification_version column
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='guild_settings' AND column_name='last_notification_version'
          ) THEN
            ALTER TABLE guild_settings ADD COLUMN last_notification_version VARCHAR(20) DEFAULT NULL;
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

      // Ticket setup messages table for custom setup text
      await client.query(`
        CREATE TABLE IF NOT EXISTS ticket_setup_messages (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL UNIQUE,
          title TEXT DEFAULT '🎫 Ticket System',
          description TEXT DEFAULT 'Wähle eine Kategorie aus, um ein neues Ticket zu erstellen:',
          color INTEGER DEFAULT 5793522,
          footer_text TEXT DEFAULT '',
          is_custom BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Auto roles table for automatic role assignment on member join
      await client.query(`
        CREATE TABLE IF NOT EXISTS auto_roles (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          role_name TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guild_id, role_id)
        )
      `);

      // Command permissions table for granular command access control per role
      await client.query(`
        CREATE TABLE IF NOT EXISTS command_permissions (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          role_name TEXT NOT NULL,
          allowed_commands TEXT DEFAULT '[]', -- JSON array of command names
          denied_commands TEXT DEFAULT '[]', -- JSON array of command names (explicit deny)
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guild_id, role_id)
        )
      `);

      // Create indexes for better performance
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_tickets_guild_id ON tickets(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_ticket_categories_guild_id ON ticket_categories(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_ticket_categories_active ON ticket_categories(is_active)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_auto_responses_guild_id ON auto_responses(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_bot_stats_guild_id ON bot_stats(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_bot_stats_executed_at ON bot_stats(executed_at)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_dscp_permissions_guild_id ON dscp_permissions(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_webhooks_guild_id ON webhooks(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON user_tokens(user_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_user_tokens_expires_at ON user_tokens(expires_at)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_ticket_categories_guild_id ON ticket_categories(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_ticket_categories_active ON ticket_categories(guild_id, is_active)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_auto_roles_guild_id ON auto_roles(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_auto_roles_active ON auto_roles(guild_id, is_active)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_id ON command_permissions(guild_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_command_permissions_role_id ON command_permissions(guild_id, role_id)",
      );

      console.log("✅ Database tables initialized");
      console.log("✅ Database initialization complete");
    } catch (error) {
      console.error("❌ Error initializing PostgreSQL tables:", error);
      throw error;
    } finally {
      if (client) {
        client.release();
        console.log("🔗 Database connection released");
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
    categoryId?: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO tickets (user_id, username, reason, channel_id, guild_id, category_id) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          ticketData.userId,
          ticketData.username,
          ticketData.reason,
          ticketData.channelId,
          ticketData.guildId,
          ticketData.categoryId || null,
        ],
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
        [ticketId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async deleteTicket(ticketId: number) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`DELETE FROM tickets WHERE id = $1`, [
        ticketId,
      ]);
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getTicketById(ticketId: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          t.*,
          tc.name as category_name,
          tc.emoji as category_emoji,
          tc.color as category_color
        FROM tickets t
        LEFT JOIN ticket_categories tc ON t.category_id = tc.id
        WHERE t.id = $1 AND t.guild_id = $2`,
        [ticketId, guildId],
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getTickets(guildId: string, status?: string) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT 
          t.*,
          tc.name as category_name,
          tc.emoji as category_emoji,
          tc.color as category_color
        FROM tickets t
        LEFT JOIN ticket_categories tc ON t.category_id = tc.id
        WHERE t.guild_id = $1`;
      const params = [guildId];

      if (status) {
        query += ` AND t.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY t.created_at DESC`;

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
        [transcript, ticketId],
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
        [ticketId, guildId],
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
        [guildId],
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
        [
          responseData.trigger,
          responseData.response,
          responseData.isEmbed,
          responseData.embedTitle,
          responseData.embedDescription,
          responseData.embedColor,
          responseData.guildId,
        ],
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
        [trigger, guildId],
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
        [guildId],
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
        [guildId],
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
        [commandName, userId, guildId],
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
        [guildId],
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
        [name, url, guildId],
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
        [guildId],
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
        [name, guildId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Permission methods
  async setUserPermissions(
    userId: string,
    guildId: string,
    role: string,
    permissions: string[],
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO user_permissions (user_id, guild_id, role, permissions) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (user_id, guild_id) 
         DO UPDATE SET role = $3, permissions = $4, created_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userId, guildId, role, JSON.stringify(permissions)],
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
        [userId, guildId],
      );
      const row = result.rows[0];
      if (row) {
        row.permissions = JSON.parse(row.permissions || "[]");
      }
      return row || null;
    } finally {
      client.release();
    }
  }

  // DSCP Permission methods
  async addDSCPPermission(permissionData: {
    guildId: string;
    type: "user" | "role";
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
        [
          permissionData.guildId,
          permissionData.type,
          permissionData.targetId,
          permissionData.targetName,
          JSON.stringify(permissionData.permissions),
        ],
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
        [guildId],
      );
      return result.rows.map((row) => ({
        ...row,
        permissions: JSON.parse(row.permissions),
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
        [id, guildId],
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
        [guildId],
      );
      const row = result.rows[0];
      if (row) {
        return {
          ...row,
          enabledFeatures: JSON.parse(row.enabled_features || "[]"), // Convert to camelCase
          enabled_features: JSON.parse(row.enabled_features || "[]"), // Keep original for compatibility
          settings: JSON.parse(row.settings || "{}"),
        };
      }

      // If no settings exist, create default settings and save to database
      const defaultFeatures = ["tickets", "autoresponses", "statistics"];
      const defaultSettings = {};

      // Insert the default settings directly within this connection
      const insertResult = await client.query(
        `INSERT INTO guild_settings (guild_id, enabled_features, settings) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [
          guildId,
          JSON.stringify(defaultFeatures),
          JSON.stringify(defaultSettings),
        ],
      );

      const newRow = insertResult.rows[0];
      return {
        ...newRow,
        enabledFeatures: JSON.parse(newRow.enabled_features || "[]"), // Convert to camelCase
        enabled_features: JSON.parse(newRow.enabled_features || "[]"), // Keep original for compatibility
        settings: JSON.parse(newRow.settings || "{}"),
      };
    } finally {
      client.release();
    }
  }

  async updateGuildSettings(
    guildId: string,
    enabledFeatures: string[],
    settings: any = {},
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO guild_settings (guild_id, enabled_features, settings) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (guild_id) 
         DO UPDATE SET enabled_features = $2, settings = $3, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [guildId, JSON.stringify(enabledFeatures), JSON.stringify(settings)],
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // JWT Token methods
  async storeUserToken(
    userId: string,
    jwtToken: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO user_tokens (user_id, jwt_token, access_token, refresh_token, expires_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id) 
         DO UPDATE SET jwt_token = $2, access_token = $3, refresh_token = $4, expires_at = $5, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userId, jwtToken, accessToken, refreshToken, expiresAt],
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async updateUserTokens(
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE user_tokens 
         SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING id`,
        [userId, accessToken, refreshToken, expiresAt],
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
        [userId],
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
        [userId],
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
        `DELETE FROM user_tokens WHERE expires_at <= CURRENT_TIMESTAMP`,
      );
      console.log(`🧹 Cleaned ${result.rowCount} expired tokens`);
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Global Admin methods
  async addGlobalAdmin(
    userId: string,
    username: string,
    level: number = 1,
    grantedBy: string,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO global_admins (user_id, username, level, granted_by) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (user_id) 
         DO UPDATE SET username = $2, level = $3, granted_by = $4, granted_at = CURRENT_TIMESTAMP, is_active = true
         RETURNING id`,
        [userId, username, level, grantedBy],
      );

      // Clear cache for this user since their admin status changed
      this.clearAdminCache(userId);
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
        [userId],
      );

      // Clear cache for this user since their admin status changed
      this.clearAdminCache(userId);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async isGlobalAdmin(
    userId: string,
  ): Promise<{ isAdmin: boolean; level: number }> {
    // Check cache first
    const cached = this.adminCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { isAdmin: cached.isAdmin, level: cached.level };
    }

    const client = await this.pool.connect();
    try {
      // Only log in development
      if (process.env.NODE_ENV !== "production") {
        console.log("🔍 Checking global admin status for userId:", userId);
      }

      const result = await client.query(
        `SELECT level FROM global_admins WHERE user_id = $1 AND is_active = true`,
        [userId],
      );

      const adminInfo =
        result.rows.length > 0
          ? { isAdmin: true, level: result.rows[0].level }
          : { isAdmin: false, level: 0 };

      // Cache the result
      this.adminCache.set(userId, {
        ...adminInfo,
        timestamp: Date.now(),
      });

      return adminInfo;
    } finally {
      client.release();
    }
  }

  // Method to clear admin cache (call when admin status changes)
  clearAdminCache(userId?: string): void {
    if (userId) {
      this.adminCache.delete(userId);
    } else {
      this.adminCache.clear();
    }
  }

  async getAllGlobalAdmins() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM global_admins WHERE is_active = true ORDER BY level DESC, granted_at DESC`,
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Global Settings methods
  async setGlobalSetting(
    key: string,
    value: string,
    type: string = "string",
    description: string = "",
    updatedBy: string,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO global_settings (setting_key, setting_value, setting_type, description, updated_by) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (setting_key) 
         DO UPDATE SET setting_value = $2, setting_type = $3, description = $4, updated_by = $5, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [key, value, type, description, updatedBy],
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
        [key],
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
        `SELECT * FROM global_settings ORDER BY setting_key ASC`,
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Admin Activity Log
  async logAdminActivity(
    adminUserId: string,
    action: string,
    targetType?: string,
    targetId?: string,
    details?: string,
    guildId?: string,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO admin_activity_log (admin_user_id, action, target_type, target_id, details, guild_id) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          adminUserId,
          action,
          targetType || null,
          targetId || null,
          details || null,
          guildId || null,
        ],
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
        [limit],
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

      return result.rows.map((row) => row.guild_id);
    } catch (error) {
      console.error("Get all guilds error:", error);
      return [];
    } finally {
      client.release();
    }
  }

  // Ticket Categories methods
  async createTicketCategory(categoryData: {
    guildId: string;
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
    sortOrder?: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO ticket_categories (guild_id, name, description, emoji, color, sort_order) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING id`,
        [
          categoryData.guildId,
          categoryData.name,
          categoryData.description || null,
          categoryData.emoji || null,
          categoryData.color || "#5865F2",
          categoryData.sortOrder || 0,
        ],
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getTicketCategories(guildId: string, activeOnly: boolean = true) {
    const client = await this.pool.connect();
    try {
      let query = `SELECT * FROM ticket_categories WHERE guild_id = $1`;
      const params = [guildId];

      if (activeOnly) {
        query += ` AND is_active = true`;
      }

      query += ` ORDER BY sort_order ASC, name ASC`;

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getTicketCategoryById(categoryId: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM ticket_categories WHERE id = $1 AND guild_id = $2`,
        [categoryId, guildId],
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async updateTicketCategory(
    categoryId: number,
    guildId: string,
    updateData: {
      name?: string;
      description?: string;
      emoji?: string;
      color?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const client = await this.pool.connect();
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updateData.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(updateData.name);
      }
      if (updateData.description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(updateData.description);
      }
      if (updateData.emoji !== undefined) {
        updates.push(`emoji = $${paramIndex++}`);
        values.push(updateData.emoji);
      }
      if (updateData.color !== undefined) {
        updates.push(`color = $${paramIndex++}`);
        values.push(updateData.color);
      }
      if (updateData.isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(updateData.isActive);
      }
      if (updateData.sortOrder !== undefined) {
        updates.push(`sort_order = $${paramIndex++}`);
        values.push(updateData.sortOrder);
      }

      if (updates.length === 0) {
        return 0; // No updates
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(categoryId, guildId);

      const query = `UPDATE ticket_categories SET ${updates.join(", ")} WHERE id = $${paramIndex++} AND guild_id = $${paramIndex++}`;

      const result = await client.query(query, values);
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async deleteTicketCategory(categoryId: number, guildId: string) {
    const client = await this.pool.connect();
    try {
      // First, set category_id to null for all tickets using this category
      await client.query(
        `UPDATE tickets SET category_id = NULL WHERE category_id = $1 AND guild_id = $2`,
        [categoryId, guildId],
      );

      // Then delete the category
      const result = await client.query(
        `DELETE FROM ticket_categories WHERE id = $1 AND guild_id = $2`,
        [categoryId, guildId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getTicketCategoriesCount(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM ticket_categories WHERE guild_id = $1 AND is_active = true`,
        [guildId],
      );
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // Ticket Setup Message methods
  async getTicketSetupMessage(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM ticket_setup_messages WHERE guild_id = $1`,
        [guildId],
      );

      if (result.rows[0]) {
        return result.rows[0];
      }

      // If no custom message exists, return default
      return {
        guild_id: guildId,
        title: "🎫 Ticket System",
        description:
          "Wähle eine Kategorie aus, um ein neues Ticket zu erstellen:",
        color: 5793522, // Discord blurple
        footer_text: "",
        is_custom: false,
      };
    } finally {
      client.release();
    }
  }

  async updateTicketSetupMessage(
    guildId: string,
    messageData: {
      title?: string;
      description?: string;
      color?: number;
      footerText?: string;
      isCustom?: boolean;
    },
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO ticket_setup_messages (guild_id, title, description, color, footer_text, is_custom) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         ON CONFLICT (guild_id) 
         DO UPDATE SET 
           title = $2, 
           description = $3, 
           color = $4, 
           footer_text = $5, 
           is_custom = $6,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          guildId,
          messageData.title || "🎫 Ticket System",
          messageData.description ||
            "Wähle eine Kategorie aus, um ein neues Ticket zu erstellen:",
          messageData.color || 5793522,
          messageData.footerText || "",
          messageData.isCustom || false,
        ],
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async resetTicketSetupMessage(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM ticket_setup_messages WHERE guild_id = $1`,
        [guildId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  // Auto Role methods
  async getAutoRoles(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM auto_roles WHERE guild_id = $1 ORDER BY created_at ASC`,
        [guildId],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getActiveAutoRoles(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM auto_roles WHERE guild_id = $1 AND is_active = true ORDER BY created_at ASC`,
        [guildId],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async addAutoRole(guildId: string, roleId: string, roleName: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO auto_roles (guild_id, role_id, role_name) VALUES ($1, $2, $3) RETURNING id`,
        [guildId, roleId, roleName],
      );
      return result.rows[0].id;
    } catch (error: any) {
      if (error.code === "23505") {
        // Unique constraint violation
        throw new Error("Diese Rolle ist bereits als Auto-Role konfiguriert.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAutoRole(
    guildId: string,
    roleId: string,
    data: { roleName?: string; isActive?: boolean },
  ) {
    const client = await this.pool.connect();
    try {
      const updates: string[] = [];
      const values: any[] = [guildId, roleId];
      let paramCount = 2;

      if (data.roleName !== undefined) {
        updates.push(`role_name = $${++paramCount}`);
        values.push(data.roleName);
      }

      if (data.isActive !== undefined) {
        updates.push(`is_active = $${++paramCount}`);
        values.push(data.isActive);
      }

      if (updates.length === 0) {
        return 0;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);

      const result = await client.query(
        `UPDATE auto_roles SET ${updates.join(", ")} WHERE guild_id = $1 AND role_id = $2`,
        values,
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async deleteAutoRole(guildId: string, roleId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM auto_roles WHERE guild_id = $1 AND role_id = $2`,
        [guildId, roleId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getAutoRolesCount(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM auto_roles WHERE guild_id = $1 AND is_active = true`,
        [guildId],
      );
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // Command Permission methods
  async getCommandPermissions(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM command_permissions WHERE guild_id = $1 ORDER BY role_name ASC`,
        [guildId],
      );
      return result.rows.map((row) => ({
        ...row,
        allowed_commands: JSON.parse(row.allowed_commands || "[]"),
        denied_commands: JSON.parse(row.denied_commands || "[]"),
      }));
    } finally {
      client.release();
    }
  }

  async getCommandPermissionForRole(guildId: string, roleId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM command_permissions WHERE guild_id = $1 AND role_id = $2`,
        [guildId, roleId],
      );

      if (result.rows[0]) {
        return {
          ...result.rows[0],
          allowed_commands: JSON.parse(result.rows[0].allowed_commands || "[]"),
          denied_commands: JSON.parse(result.rows[0].denied_commands || "[]"),
        };
      }

      return null;
    } finally {
      client.release();
    }
  }

  async updateCommandPermissions(
    guildId: string,
    roleId: string,
    data: {
      roleName: string;
      allowedCommands: string[];
      deniedCommands: string[];
    },
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO command_permissions (guild_id, role_id, role_name, allowed_commands, denied_commands) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (guild_id, role_id) 
         DO UPDATE SET 
           role_name = $3,
           allowed_commands = $4,
           denied_commands = $5,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          guildId,
          roleId,
          data.roleName,
          JSON.stringify(data.allowedCommands),
          JSON.stringify(data.deniedCommands),
        ],
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async deleteCommandPermissions(guildId: string, roleId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM command_permissions WHERE guild_id = $1 AND role_id = $2`,
        [guildId, roleId],
      );
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  async getUserAllowedCommands(
    guildId: string,
    userId: string,
    userRoles: string[],
  ) {
    const client = await this.pool.connect();
    try {
      // Get all command permissions for user's roles
      const result = await client.query(
        `SELECT allowed_commands, denied_commands FROM command_permissions 
         WHERE guild_id = $1 AND role_id = ANY($2::text[])`,
        [guildId, userRoles],
      );

      const allowedCommands = new Set<string>();
      const deniedCommands = new Set<string>();

      // Collect all allowed and denied commands from all roles
      result.rows.forEach((row) => {
        const allowed = JSON.parse(row.allowed_commands || "[]");
        const denied = JSON.parse(row.denied_commands || "[]");

        allowed.forEach((cmd: string) => allowedCommands.add(cmd));
        denied.forEach((cmd: string) => deniedCommands.add(cmd));
      });

      // Denied commands take precedence over allowed commands
      const finalAllowed = Array.from(allowedCommands).filter(
        (cmd) => !deniedCommands.has(cmd),
      );

      return {
        allowed: finalAllowed,
        denied: Array.from(deniedCommands),
      };
    } finally {
      client.release();
    }
  }

  // === NOTIFICATION SYSTEM METHODS ===

  // Get notification settings for a guild
  async getNotificationSettings(guildId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT notification_category_id, info_channel_id, notification_roles, notifications_enabled, last_notification_version, notifications_setup_completed 
         FROM guild_settings WHERE guild_id = $1`,
        [guildId],
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        notificationCategoryId: row.notification_category_id,
        infoChannelId: row.info_channel_id,
        notificationRoles: JSON.parse(row.notification_roles || "[]"),
        notificationsEnabled: row.notifications_enabled ?? true,
        lastNotificationVersion: row.last_notification_version,
        setupCompleted: row.notifications_setup_completed ?? false,
      };
    } finally {
      client.release();
    }
  }

  // Update notification settings for a guild
  async updateNotificationSettings(
    guildId: string,
    categoryId: string | null,
    channelId: string | null,
    roleIds: string[] = [],
    notificationsEnabled: boolean = true,
    lastNotificationVersion?: string,
  ) {
    const client = await this.pool.connect();
    try {
      let query = `UPDATE guild_settings 
         SET notification_category_id = $2, 
             info_channel_id = $3, 
             notification_roles = $4,
             notifications_enabled = $5,
             updated_at = CURRENT_TIMESTAMP`;

      let params: any[] = [
        guildId,
        categoryId,
        channelId,
        JSON.stringify(roleIds),
        notificationsEnabled,
      ];

      if (lastNotificationVersion !== undefined) {
        query += `, last_notification_version = $6`;
        params.push(lastNotificationVersion);
      }

      query += ` WHERE guild_id = $1`;

      await client.query(query, params);
      return true;
    } catch (error) {
      console.error("Error updating notification settings:", error);
      return false;
    } finally {
      client.release();
    }
  }

  // Create initial notification settings when guild is first set up
  async initializeNotificationSystem(
    guildId: string,
    categoryId: string,
    channelId: string,
  ) {
    const client = await this.pool.connect();
    try {
      // Update or insert notification settings
      const result = await client.query(
        `UPDATE guild_settings 
         SET notification_category_id = $2, 
             info_channel_id = $3,
             notification_roles = '[]',
             notifications_enabled = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE guild_id = $1`,
        [guildId, categoryId, channelId],
      );

      // If no existing settings, create them
      if (result.rowCount === 0) {
        await client.query(
          `INSERT INTO guild_settings 
           (guild_id, enabled_features, settings, notification_category_id, info_channel_id, notification_roles, notifications_enabled) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            guildId,
            JSON.stringify(["tickets", "autoresponses", "statistics"]),
            JSON.stringify({}),
            categoryId,
            channelId,
            JSON.stringify([]),
            true,
          ],
        );
      }
      return true;
    } catch (error) {
      console.error("Error initializing notification system:", error);
      return false;
    } finally {
      client.release();
    }
  }

  // Get all guilds with notification channels for version announcements
  async getAllNotificationChannels() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT guild_id, info_channel_id, notification_roles 
         FROM guild_settings 
         WHERE info_channel_id IS NOT NULL`,
      );

      return result.rows.map((row) => ({
        guildId: row.guild_id,
        channelId: row.info_channel_id,
        allowedRoles: JSON.parse(row.notification_roles || "[]"),
      }));
    } finally {
      client.release();
    }
  }

  // Get guilds that need version notifications
  async getGuildsNeedingVersionNotification(currentVersion: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT guild_id, info_channel_id, notification_roles, notifications_enabled
         FROM guild_settings 
         WHERE info_channel_id IS NOT NULL 
         AND notifications_enabled = true
         AND (last_notification_version IS NULL OR last_notification_version != $1)`,
        [currentVersion],
      );

      return result.rows.map((row) => ({
        guildId: row.guild_id,
        channelId: row.info_channel_id,
        allowedRoles: JSON.parse(row.notification_roles || "[]"),
      }));
    } finally {
      client.release();
    }
  }

  // Close all connections
  async close() {
    await this.pool.end();
    console.log("🔒 PostgreSQL connection pool closed");
  }
}

// Export singleton instance
export const dbManager = new DatabaseManager();
