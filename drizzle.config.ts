import { defineConfig } from 'drizzle-kit';

// Used only to print the SQL of a schema change (npm run db:generate).
// The SQL is then copied into a new file of src/db/migrations.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './.drizzle',
});
