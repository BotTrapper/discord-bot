import { dbManager } from './database.js';

/**
 * Initialize database and create default data if needed
 */
export async function initializeDatabase() {
  console.log('🔧 Initializing database...');
  
  try {
    // Database tables are automatically created in DatabaseManager constructor
    console.log('✅ Database tables initialized');
    
    // Add any future migration logic here
    
    console.log('✅ Database initialization complete');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

/**
 * Initialize default data for a new guild
 */
export async function initializeGuildDefaults(guildId: string) {
  try {
    // Check if guild already has auto responses
    const existingResponses = await dbManager.getAutoResponses(guildId) as any[];
    
    if (existingResponses.length === 0) {
      // Add default auto responses
      const defaultResponses = [
        {
          trigger: 'hallo',
          response: 'Hallo! Wie kann ich dir helfen?',
          isEmbed: false,
          guildId
        },
        {
          trigger: 'help',
          response: 'Bot Hilfe',
          isEmbed: true,
          embedTitle: '🤖 Bot Hilfe',
          embedDescription: 'Verfügbare Befehle:\n\n`/ticket create` - Erstelle ein Ticket\n`/embed` - Erstelle ein Embed\n`/autoresponse` - Verwalte automatische Antworten\n`/webhook` - Verwalte Webhooks\n`/stats` - Zeige Statistiken',
          embedColor: 0x00AE86,
          guildId
        },
        {
          trigger: 'danke',
          response: 'Gerne! 😊',
          isEmbed: false,
          guildId
        }
      ];

      for (const response of defaultResponses) {
        await dbManager.addAutoResponse(response);
      }
      
      console.log(`✅ Default auto responses created for guild ${guildId}`);
    }
  } catch (error) {
    console.error(`❌ Error initializing defaults for guild ${guildId}:`, error);
  }
}
