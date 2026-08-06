import { initDatabaseSchema, resetDatabase } from './db-engine';

const action = process.argv[2];

if (action === 'reset') {
  resetDatabase();
  console.log('✓ Database reset successfully.');
} else if (action === 'migrate') {
  initDatabaseSchema();
  console.log('✓ Database schema migrated successfully.');
} else {
  console.log('Usage: tsx src/db-cli.ts [migrate|reset]');
}
