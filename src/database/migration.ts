import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import path from 'path';

interface MigrationConfig {
  sqlitePath: string;
  postgresConnectionString: string;
}

export class DatabaseMigration {
  private sqliteDb: sqlite3.Database;
  private pgPool: Pool;

  constructor(config: MigrationConfig) {
    this.sqliteDb = new sqlite3.Database(config.sqlitePath);
    this.pgPool = new Pool({
      connectionString: config.postgresConnectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }

  async migrate() {
    console.log('🔄 Starting database migration from SQLite to PostgreSQL...');

    try {
      // First, ensure PostgreSQL tables exist
      await this.createPostgresTables();

      // Migrate each table
      await this.migrateTable('tickets', this.mapTicketRow);
      await this.migrateTable('auto_responses', this.mapAutoResponseRow);
      await this.migrateTable('webhooks', this.mapWebhookRow);
      await this.migrateTable('bot_stats', this.mapBotStatsRow);
      await this.migrateTable('user_permissions', this.mapUserPermissionRow);
      await this.migrateTable('dscp_permissions', this.mapDSCPPermissionRow);
      await this.migrateTable('guild_settings', this.mapGuildSettingsRow);

      console.log('✅ Migration completed successfully!');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  private async createPostgresTables() {
    const client = await this.pgPool.connect();
    try {
      console.log('📋 Creating PostgreSQL tables...');

      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Create all tables (same as in the new database manager)
      const tables = [
        `CREATE TABLE IF NOT EXISTS tickets (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          channel_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMP WITH TIME ZONE,
          guild_id TEXT
        )`,

        `CREATE TABLE IF NOT EXISTS auto_responses (
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
        )`,

        `CREATE TABLE IF NOT EXISTS webhooks (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          guild_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, guild_id)
        )`,

        `CREATE TABLE IF NOT EXISTS bot_stats (
          id SERIAL PRIMARY KEY,
          command_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          guild_id TEXT,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS user_permissions (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          role TEXT NOT NULL,
          permissions TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, guild_id)
        )`,

        `CREATE TABLE IF NOT EXISTS dscp_permissions (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_name TEXT NOT NULL,
          permissions TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guild_id, type, target_id)
        )`,

        `CREATE TABLE IF NOT EXISTS guild_settings (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL UNIQUE,
          enabled_features TEXT DEFAULT '["tickets","autoresponses","statistics","webhooks"]',
          settings TEXT DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      for (const tableQuery of tables) {
        await client.query(tableQuery);
      }

      // Create indexes
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_tickets_guild_id ON tickets(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)',
        'CREATE INDEX IF NOT EXISTS idx_auto_responses_guild_id ON auto_responses(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_bot_stats_guild_id ON bot_stats(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_bot_stats_executed_at ON bot_stats(executed_at)',
        'CREATE INDEX IF NOT EXISTS idx_dscp_permissions_guild_id ON dscp_permissions(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_webhooks_guild_id ON webhooks(guild_id)'
      ];

      for (const indexQuery of indexes) {
        await client.query(indexQuery);
      }

      console.log('✅ PostgreSQL tables created successfully!');
    } finally {
      client.release();
    }
  }

  private async migrateTable(tableName: string, mapRowFunction: (row: any) => any) {
    return new Promise<void>((resolve, reject) => {
      console.log(`🔄 Migrating table: ${tableName}`);

      this.sqliteDb.all(`SELECT * FROM ${tableName}`, async (err, rows) => {
        if (err) {
          console.error(`❌ Error reading from SQLite table ${tableName}:`, err);
          return reject(err);
        }

        if (!rows || rows.length === 0) {
          console.log(`ℹ️  No data found in table ${tableName}`);
          return resolve();
        }

        const client = await this.pgPool.connect();

        try {
          let migratedCount = 0;

          for (const row of rows) {
            try {
              const mappedRow = mapRowFunction(row);
              await client.query(mappedRow.query, mappedRow.values);
              migratedCount++;
            } catch (insertError) {
              console.warn(`⚠️  Failed to insert row in ${tableName}:`, insertError);
              // Continue with other rows
            }
          }

          console.log(`✅ Migrated ${migratedCount}/${rows.length} rows from table ${tableName}`);
          resolve();
        } catch (error) {
          console.error(`❌ Error migrating table ${tableName}:`, error);
          reject(error);
        } finally {
          client.release();
        }
      });
    });
  }

  // Row mapping functions
  private mapTicketRow(row: any) {
    return {
      query: `INSERT INTO tickets (user_id, username, reason, status, channel_id, created_at, closed_at, guild_id) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      values: [
        row.user_id,
        row.username,
        row.reason,
        row.status,
        row.channel_id,
        row.created_at,
        row.closed_at,
        row.guild_id
      ]
    };
  }

  private mapAutoResponseRow(row: any) {
    return {
      query: `INSERT INTO auto_responses (trigger_word, response_text, is_embed, embed_title, embed_description, embed_color, guild_id, created_at) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (trigger_word, guild_id) DO NOTHING`,
      values: [
        row.trigger_word,
        row.response_text,
        row.is_embed,
        row.embed_title,
        row.embed_description,
        row.embed_color,
        row.guild_id,
        row.created_at
      ]
    };
  }

  private mapWebhookRow(row: any) {
    return {
      query: `INSERT INTO webhooks (name, url, guild_id, created_at) 
              VALUES ($1, $2, $3, $4) ON CONFLICT (name, guild_id) DO NOTHING`,
      values: [
        row.name,
        row.url,
        row.guild_id,
        row.created_at
      ]
    };
  }

  private mapBotStatsRow(row: any) {
    return {
      query: `INSERT INTO bot_stats (command_name, user_id, guild_id, executed_at) 
              VALUES ($1, $2, $3, $4)`,
      values: [
        row.command_name,
        row.user_id,
        row.guild_id,
        row.executed_at
      ]
    };
  }

  private mapUserPermissionRow(row: any) {
    return {
      query: `INSERT INTO user_permissions (user_id, guild_id, role, permissions, created_at) 
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, guild_id) DO UPDATE SET role = $3, permissions = $4`,
      values: [
        row.user_id,
        row.guild_id,
        row.role,
        row.permissions,
        row.created_at
      ]
    };
  }

  private mapDSCPPermissionRow(row: any) {
    return {
      query: `INSERT INTO dscp_permissions (guild_id, type, target_id, target_name, permissions, created_at, updated_at) 
              VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guild_id, type, target_id) DO UPDATE SET target_name = $4, permissions = $5, updated_at = $7`,
      values: [
        row.guild_id,
        row.type,
        row.target_id,
        row.target_name,
        row.permissions,
        row.created_at,
        row.updated_at
      ]
    };
  }

  private mapGuildSettingsRow(row: any) {
    return {
      query: `INSERT INTO guild_settings (guild_id, enabled_features, settings, created_at, updated_at) 
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guild_id) DO UPDATE SET enabled_features = $2, settings = $3, updated_at = $5`,
      values: [
        row.guild_id,
        row.enabled_features,
        row.settings,
        row.created_at,
        row.updated_at
      ]
    };
  }

  private async close() {
    this.sqliteDb.close();
    await this.pgPool.end();
  }
}

// Migration script
async function runMigration() {
  const sqlitePath = process.env.SQLITE_DATABASE_PATH || './data/bot.db';
  const postgresConnectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bottrapper'}`;

  console.log('🔧 Migration Configuration:');
  console.log(`   SQLite Path: ${sqlitePath}`);
  console.log(`   PostgreSQL: ${postgresConnectionString.replace(/:([^:@]+)@/, ':****@')}`); // Hide password

  const migration = new DatabaseMigration({
    sqlitePath,
    postgresConnectionString
  });

  try {
    await migration.migrate();
    console.log('🎉 Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  }
}

// Run migration automatically when this file is executed
runMigration();

export { runMigration };
