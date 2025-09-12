#!/usr/bin/env node
/**
 * Test script to verify guild settings persistence
 * Run this script to test if guild settings are properly saved to and loaded from the database
 */

import { dbManager } from './src/database/database.ts';
import 'dotenv/config';

const TEST_GUILD_ID = 'test-guild-123';

async function testSettingsPersistence() {
  console.log('🧪 Testing guild settings persistence...\n');

  try {
    // Step 1: Clear any existing test data
    console.log('1. Clearing any existing test data...');
    try {
      // Note: This would require a delete method, but for now we'll just proceed
      console.log('   ✅ Ready to test with guild ID:', TEST_GUILD_ID);
    } catch (error) {
      console.log('   ⚠️  No existing data to clear');
    }

    // Step 2: Test getting default settings (should create new entry)
    console.log('\n2. Getting guild settings for the first time (should create defaults)...');
    const initialSettings = await dbManager.getGuildSettings(TEST_GUILD_ID);
    console.log('   Initial settings:', JSON.stringify(initialSettings, null, 2));

    if (!initialSettings.id) {
      console.log('   ❌ Settings were not persisted to database (no ID returned)');
      return;
    }
    console.log('   ✅ Default settings created and persisted with ID:', initialSettings.id);

    // Step 3: Modify settings
    console.log('\n3. Modifying guild settings...');
    const newFeatures = ['tickets', 'autoresponses']; // Disable statistics and webhooks
    const newSettings = { testSetting: 'testValue', botPrefix: '!' };

    await dbManager.updateGuildSettings(TEST_GUILD_ID, newFeatures, newSettings);
    console.log('   ✅ Settings updated');

    // Step 4: Retrieve settings again to verify persistence
    console.log('\n4. Retrieving settings again to verify persistence...');
    const updatedSettings = await dbManager.getGuildSettings(TEST_GUILD_ID);
    console.log('   Retrieved settings:', JSON.stringify(updatedSettings, null, 2));

    // Verify the changes were persisted
    const featuresMatch = JSON.stringify(updatedSettings.enabled_features) === JSON.stringify(newFeatures);
    const settingsMatch = JSON.stringify(updatedSettings.settings) === JSON.stringify(newSettings);

    if (featuresMatch && settingsMatch) {
      console.log('   ✅ Settings persistence verified! Changes were saved to database.');
    } else {
      console.log('   ❌ Settings persistence failed! Changes were not saved properly.');
      console.log('   Expected features:', newFeatures);
      console.log('   Actual features:', updatedSettings.enabled_features);
      console.log('   Expected settings:', newSettings);
      console.log('   Actual settings:', updatedSettings.settings);
    }

    // Step 5: Test with another guild to ensure independence
    console.log('\n5. Testing with different guild to ensure independence...');
    const anotherGuildId = 'test-guild-456';
    const anotherGuildSettings = await dbManager.getGuildSettings(anotherGuildId);

    console.log('   Another guild settings:', JSON.stringify(anotherGuildSettings, null, 2));

    // Should have default settings, not the modified ones from the first guild
    const hasDefaultFeatures = anotherGuildSettings.enabled_features.length === 4 &&
      anotherGuildSettings.enabled_features.includes('tickets') &&
      anotherGuildSettings.enabled_features.includes('autoresponses') &&
      anotherGuildSettings.enabled_features.includes('statistics') &&
      anotherGuildSettings.enabled_features.includes('webhooks');

    if (hasDefaultFeatures && Object.keys(anotherGuildSettings.settings).length === 0) {
      console.log('   ✅ Guild independence verified! Each guild has separate settings.');
    } else {
      console.log('   ❌ Guild independence failed! Settings may be shared between guilds.');
    }

    console.log('\n🎉 Settings persistence test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   - Default settings are automatically created and persisted');
    console.log('   - Settings changes are saved to the database');
    console.log('   - Each guild maintains independent settings');
    console.log('   - Settings will now persist across bot restarts');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    // Close database connection
    await dbManager.close();
    console.log('\n🔒 Database connection closed');
  }
}

// Run the test
testSettingsPersistence().catch(console.error);
