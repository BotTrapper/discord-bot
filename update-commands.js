// Quick script to update Discord commands manually
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Add your test guild ID to .env

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in .env file');
  process.exit(1);
}

async function updateCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('🔄 Started refreshing application (/) commands.');

    if (GUILD_ID) {
      // Update commands for specific guild (faster)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: [] }
      );
      console.log('✅ Successfully cleared guild commands.');
    } else {
      // Update global commands (takes up to 1 hour)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: [] }
      );
      console.log('✅ Successfully cleared global commands.');
    }

    console.log('🔄 Commands cleared! Restart your bot to register new commands.');
    
  } catch (error) {
    console.error('❌ Error updating commands:', error);
  }
}

updateCommands();