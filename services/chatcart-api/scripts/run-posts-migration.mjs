import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = ['003_posts_schema.sql', '004_social_schema.sql', '005_user_buyer_location.sql'];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — set it in services/chatcart-api/.env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  for (const file of files) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log(`Applied ${file}`);
  }
  console.log('Posts + social schema migrations applied successfully.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
