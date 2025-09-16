/**
 * Test script to verify the global admin migration works correctly
 */

import { dbManager } from './src/database/database.js';
import { initializeDatabase } from './src/database/migrations.js';

async function testMigration() {
  console.log('🧪 Testing global admin migration...');
  
  try {
    // Initialize the database (which will run migrations)
    await initializeDatabase();
    
    // Check if justusplays78 is now a global admin
    const adminCheck = await dbManager.isGlobalAdmin('281491350632005633');
    
    if (adminCheck.isAdmin) {
      console.log(`✅ SUCCESS: justusplays78 is now a global admin with level ${adminCheck.level}`);
    } else {
      console.log('❌ FAILED: justusplays78 is not a global admin');
    }
    
    // Get all global admins to verify
    const allAdmins = await dbManager.getAllGlobalAdmins();
    console.log(`📋 Total global admins: ${allAdmins.length}`);
    allAdmins.forEach(admin => {
      console.log(`   - ${admin.username} (${admin.user_id}) - Level ${admin.level}`);
    });
    
    console.log('✅ Migration test completed');
  } catch (error) {
    console.error('❌ Migration test failed:', error);
  } finally {
    // Close database connection
    await dbManager.close();
    process.exit(0);
  }
}

testMigration();