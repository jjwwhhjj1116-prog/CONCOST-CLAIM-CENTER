import { getDatabaseUrl, migrateDatabase, resetDatabase } from './db-engine';

async function main(): Promise<void> {
  const action = process.argv[2];
  const databaseUrl = getDatabaseUrl();
  if (action === 'reset') {
    await resetDatabase(databaseUrl);
    console.log('Database reset and migration SQL applied successfully.');
  } else if (action === 'migrate') {
    await migrateDatabase(databaseUrl);
    console.log('Database migration SQL applied successfully.');
  } else {
    throw new Error('Usage: tsx src/db-cli.ts [migrate|reset]');
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
