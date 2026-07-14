import pg from 'pg';
import { config } from './config.mjs';

const { Pool } = pg;

export const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl })
  : null;

export async function ensureUser(userId) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [userId]
  );
}
