import net from 'node:net';
import pg from 'pg';
import { config } from './config.mjs';

const { Pool } = pg;

/**
 * Node 20+ resolves a host to both IPv4 and IPv6 and races them, giving each
 * attempt only **250ms** before starting the next. That default is tuned for a
 * service on the same network. A serverless Postgres across the internet routinely
 * needs a second or more just to accept the socket, so every attempt is abandoned
 * before it can succeed and the pool surfaces a bare `ETIMEDOUT`.
 *
 * The symptom is nasty precisely because it is intermittent: it looks like the
 * database is flaky when the real problem is that the client gave up too early.
 * Raising the per-attempt budget lets the connection that would have worked finish.
 */
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
  net.setDefaultAutoSelectFamilyAttemptTimeout(
    Number(process.env.NET_AUTO_SELECT_ATTEMPT_TIMEOUT_MS || 5000)
  );
}

/**
 * The connection pool.
 *
 * The timeouts are deliberate. Without `connectionTimeoutMillis` a request that
 * cannot reach the database hangs until the socket gives up, which reads to the
 * caller as a request that never returns rather than one that failed. With it, a
 * blip surfaces as an error the route can answer.
 *
 * `max` is kept low because the app sits in front of a pooler that has its own
 * limit; opening more sockets than the pooler will serve just moves the queue.
 */
export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 15000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      // Serverless Postgres suspends idle computes and poolers drop quiet sockets.
      // TCP keepalive is what keeps a pooled connection from being reaped between
      // requests, which otherwise shows up as a random timeout under load.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      // A dropped idle connection must not take the process with it.
      allowExitOnIdle: false,
    })
  : null;

if (pool) {
  pool.on('error', (error) => {
    console.error('Postgres pool error (idle client):', error?.message);
  });
}

export async function ensureUser(userId) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [userId]
  );
}
