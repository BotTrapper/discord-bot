#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

// Import the compiled JavaScript version
const { Pool } = require('pg');

class DatabaseManager {
  constructor() {
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bottrapper'}`;

    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
      application_name: 'BotTrapper-Admin-Setup'
    });
  }

  async addGlobalAdmin(userId, username, level = 1, grantedBy) {
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

  async isGlobalAdmin(userId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT id, level FROM global_admins WHERE user_id = $1 AND is_active = true',
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

  async close() {
    await this.pool.end();
  }
}

async function addAdmin() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('❌ Usage: node add-admin.js <USER_ID> <USERNAME> [LEVEL]');
    console.log('   USER_ID:  Discord User ID (z.B. 123456789012345678)');
    console.log('   USERNAME: Discord Username (z.B. MaxMustermann)');
    console.log('   LEVEL:    Admin Level 1-3 (optional, default: 3)');
    console.log('');
    console.log('Beispiel: node add-admin.js 123456789012345678 MaxMustermann 3');
    process.exit(1);
  }

  const userId = args[0];
  const username = args[1];
  const level = parseInt(args[2]) || 3; // Default to highest level

  if (isNaN(parseInt(userId))) {
    console.log('❌ USER_ID muss eine gültige Zahl sein');
    process.exit(1);
  }

  if (level < 1 || level > 3) {
    console.log('❌ LEVEL muss zwischen 1 und 3 liegen');
    process.exit(1);
  }

  console.log('🔧 Initialisiere Datenbankverbindung...');
  
  const db = new DatabaseManager();
  
  try {
    // Warten bis die Verbindung aufgebaut ist
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`📝 Füge Admin hinzu: ${username} (${userId}) mit Level ${level}`);
    
    const adminId = await db.addGlobalAdmin(userId, username, level, 'SYSTEM');
    
    console.log(`✅ Admin erfolgreich hinzugefügt!`);
    console.log(`   ID: ${adminId}`);
    console.log(`   User: ${username} (${userId})`);
    console.log(`   Level: ${level}`);
    
    // Prüfe, ob der Admin korrekt gesetzt wurde
    const check = await db.isGlobalAdmin(userId);
    if (check.isAdmin) {
      console.log(`🎉 Verifikation erfolgreich: Admin-Status bestätigt (Level ${check.level})`);
    } else {
      console.log('⚠️  Warnung: Admin-Status konnte nicht verifiziert werden');
    }
    
  } catch (error) {
    console.error('❌ Fehler beim Hinzufügen des Admins:', error.message);
    process.exit(1);
  } finally {
    console.log('🔒 Schließe Datenbankverbindung...');
    await db.close();
    process.exit(0);
  }
}

addAdmin();