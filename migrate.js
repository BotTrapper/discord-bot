#!/usr/bin/env node
const { runMigration } = require('./src/database/migration.js');

console.log('🚀 Starting BotTrapper Database Migration');
console.log('=====================================');

runMigration();
