import { dbManager } from "./database.js";

/**
 * Initialize database and create default data if needed
 */
export async function initializeDatabase() {
  console.log("🔧 Initializing database...");

  try {
    // Database tables are automatically created in DatabaseManager constructor
    console.log("✅ Database tables initialized");

    // Run migrations
    await runMigrations();

    console.log("✅ Database initialization complete");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    throw error;
  }
}

/**
 * Run database migrations
 */
async function runMigrations() {
  console.log("🔧 Running database migrations...");

  try {
    // Migration: Add default global admin (justusplays78)
    await addDefaultGlobalAdmin();

    console.log("✅ All migrations completed");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

/**
 * Migration: Add default global admin user
 */
async function addDefaultGlobalAdmin() {
  const defaultAdminId = "281491350632005633";
  const defaultAdminUsername = "justusplays78";

  try {
    // Check if the default admin already exists
    const existingAdmin = await dbManager.isGlobalAdmin(defaultAdminId);

    if (!existingAdmin.isAdmin) {
      // Add the default admin with level 3 (highest level)
      await dbManager.addGlobalAdmin(
        defaultAdminId,
        defaultAdminUsername,
        3,
        "SYSTEM_MIGRATION",
      );
      console.log(
        `✅ Default global admin ${defaultAdminUsername} (${defaultAdminId}) added successfully`,
      );
    } else {
      console.log(
        `ℹ️  Default global admin ${defaultAdminUsername} already exists with level ${existingAdmin.level}`,
      );
    }
  } catch (error) {
    console.error("❌ Failed to add default global admin:", error);
    throw error;
  }
}

/**
 * Initialize default data for a new guild
 */
export async function initializeGuildDefaults(guildId: string) {
  try {
    // Initialize default guild settings if they don't exist
    const existingSettings = await dbManager.getGuildSettings(guildId);

    // If guild settings don't exist in database, create them (FIRST TIME SETUP)
    const isFirstTimeSetup = !existingSettings.id;
    
    if (isFirstTimeSetup) {
      const defaultFeatures = [
        "tickets",
        "autoresponses", 
        "statistics",
        "webhooks",
      ];
      const defaultSettings = {};

      await dbManager.updateGuildSettings(
        guildId,
        defaultFeatures,
        defaultSettings,
      );
      console.log(`✅ Default guild settings created for guild ${guildId}`);

      // Only add default data during FIRST TIME SETUP
      await addDefaultAutoResponses(guildId);
      await addDefaultTicketCategories(guildId);
    } else {
      console.log(`ℹ️  Guild ${guildId} already initialized, skipping defaults`);
    }
  } catch (error) {
    console.error(
      `❌ Error initializing defaults for guild ${guildId}:`,
      error,
    );
  }
}

/**
 * Add default auto responses for a new guild
 */
async function addDefaultAutoResponses(guildId: string) {
  try {
    // Add default auto responses
    const defaultResponses = [
      {
        trigger: "hallo",
        response: "Hallo! Wie kann ich dir helfen?",
        isEmbed: false,
        guildId,
      },
      {
        trigger: "help",
        response: "Bot Hilfe",
        isEmbed: true,
        embedTitle: "🤖 Bot Hilfe",
        embedDescription:
          "Verfügbare Befehle:\n\n`/ticket create` - Erstelle ein Ticket\n`/embed` - Erstelle ein Embed\n`/autoresponse` - Verwalte automatische Antworten\n`/webhook` - Verwalte Webhooks\n`/stats` - Zeige Statistiken",
        embedColor: 0x00ae86,
        guildId,
      },
      {
        trigger: "danke",
        response: "Gerne! 😊",
        isEmbed: false,
        guildId,
      },
    ];

    for (const response of defaultResponses) {
      await dbManager.addAutoResponse(response);
    }

    console.log(`✅ Default auto responses created for guild ${guildId}`);
  } catch (error) {
    console.error(`❌ Error adding default auto responses for guild ${guildId}:`, error);
  }
}

/**
 * Add default ticket categories for a new guild
 */
async function addDefaultTicketCategories(guildId: string) {
  try {
    // Add default ticket categories
    const defaultCategories = [
      {
        guildId,
        name: "Allgemeine Hilfe",
        description: "Allgemeine Fragen und Support",
        emoji: "❓",
        color: "#5865F2",
        sortOrder: 0,
      },
      {
        guildId,
        name: "Technische Probleme",
        description: "Hilfe bei technischen Schwierigkeiten",
        emoji: "🔧",
        color: "#ED4245",
        sortOrder: 1,
      },
      {
        guildId,
        name: "Moderation",
        description: "Meldungen und Moderationsanfragen",
        emoji: "🛡️",
        color: "#FEE75C",
        sortOrder: 2,
      },
      {
        guildId,
        name: "Feedback",
        description: "Vorschläge und Feedback",
        emoji: "💡",
        color: "#57F287",
        sortOrder: 3,
      },
    ];

    for (const category of defaultCategories) {
      await dbManager.createTicketCategory(category);
    }

    console.log(`✅ Default ticket categories created for guild ${guildId}`);
  } catch (error) {
    console.error(`❌ Error adding default ticket categories for guild ${guildId}:`, error);
  }
}
