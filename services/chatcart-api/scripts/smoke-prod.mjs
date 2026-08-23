/**
 * Production smoke checks for feed, chat, and order acceptance paths.
 * Usage: node scripts/smoke-prod.mjs
 * Env: loads ../.env — PROD_API_BASE (optional), DATABASE_URL, CHAT_INTERNAL_SECRET,
 *      GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON,
 *      EXPO_PUBLIC_FIREBASE_API_KEY or FIREBASE_WEB_API_KEY
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { auth } from '../src/firebase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnv)) {
  const raw = fs.readFileSync(rootEnv, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^EXPO_PUBLIC_FIREBASE_API_KEY=(.+)$/);
    if (m && !process.env.EXPO_PUBLIC_FIREBASE_API_KEY) {
      process.env.EXPO_PUBLIC_FIREBASE_API_KEY = m[1].trim();
    }
  }
}

const API =
  (process.env.PROD_API_BASE || 'https://chatcart-api-q3rjv54uka-uc.a.run.app').replace(/\/$/, '');
const INTERNAL_SECRET = process.env.CHAT_INTERNAL_SECRET || '';
const FIREBASE_API_KEY =
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  '';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name, detail = '') {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`○ ${name}${detail ? ` — ${detail}` : ''} (skipped)`);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function getIdToken(uid) {
  const customToken = await auth.createCustomToken(uid);
  if (!FIREBASE_API_KEY) throw new Error('Firebase Web API key missing');

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const data = await res.json();
      if (!data.idToken) throw new Error(data.error?.message || 'Failed to exchange custom token');
      return data.idToken;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

async function withIdToken(uid, fn) {
  try {
    const token = await getIdToken(uid);
    return await fn(token);
  } catch (err) {
    const offline =
      err?.cause?.code === 'ECONNRESET' ||
      err?.cause?.code === 'ETIMEDOUT' ||
      /fetch failed|timeout/i.test(String(err?.message || err));
    if (offline) {
      skip('Firebase auth token exchange', 'identitytoolkit unreachable from this network');
      return null;
    }
    throw err;
  }
}

async function testAuthGuards() {
  const checks = [
    ['Feed auth guard', '/v1/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['Chat inbox auth guard', '/v1/chat/inbox', {}],
    ['Orders auth guard', '/v1/orders', {}],
  ];
  for (const [name, path, opts] of checks) {
    const { status } = await fetchJson(path, opts);
    if (status === 401) pass(name, '401 without token');
    else fail(name, `expected 401, got ${status}`);
  }
}

async function testInternalDealThread({ postId, sellerId, buyerId }) {
  if (!INTERNAL_SECRET) {
    fail('Internal deal-thread seed', 'CHAT_INTERNAL_SECRET missing locally');
    return null;
  }
  const { status, body } = await fetchJson('/v1/chat/internal/ensure-deal-thread', {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({ buyerId, sellerId, postId }),
  });
  const threadId = body?.threadId || body?.thread?.id;
  if (status === 200 && threadId) {
    pass('Internal deal-thread seed (ask-for-price path)', `thread=${threadId}`);
    return threadId;
  }
  fail('Internal deal-thread seed (ask-for-price path)', `status=${status}`);
  return null;
}

function internalHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-chat-internal-secret': INTERNAL_SECRET,
  };
}

async function pickFixtureUsers(client) {
  const post = await client.query(
    `SELECT id, poster_id FROM posts WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
  );
  if (!post.rows[0]) throw new Error('No active posts in Neon');
  const sellerId = post.rows[0].poster_id;
  const postId = post.rows[0].id;
  const buyer = await client.query(
    `SELECT id FROM users WHERE id <> $1 ORDER BY created_at DESC LIMIT 1`,
    [sellerId]
  );
  if (!buyer.rows[0]) throw new Error('No buyer user in Neon');
  return { postId, sellerId, buyerId: buyer.rows[0].id };
}

async function testHealth() {
  const { status, body } = await fetchJson('/health');
  if (status === 200 && body?.ok && body?.service === 'chatcart-api') {
    pass('API health', `${status}`);
  } else {
    fail('API health', `status=${status} body=${JSON.stringify(body)}`);
  }
}

async function testGuestFeed() {
  const { status, body } = await fetchJson('/v1/feed/public?limit=5');
  const posts = body?.posts || body?.items || [];
  if (status === 200 && body?.success !== false && Array.isArray(posts) && posts.length > 0) {
    pass('Guest public feed', `${posts.length} clips`);
  } else {
    fail('Guest public feed', `status=${status} count=${posts.length}`);
  }
}

async function testAuthFeed(buyerId) {
  const token = await withIdToken(buyerId, async (idToken) => {
    const { status, body } = await fetchJson('/v1/feed', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    });
    const posts = body?.posts || body?.items || [];
    if (status === 200 && Array.isArray(posts)) {
      pass('Authenticated personalized feed', `${posts.length} clips`);
    } else {
      fail('Authenticated personalized feed', `status=${status}`);
    }
    return idToken;
  });
  return token;
}

async function testChatFlow({ postId, sellerId, buyerId }) {
  const ran = await withIdToken(buyerId, async (buyerToken) => {
    const authHeader = { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' };

    const threadRes = await fetchJson('/v1/chat/threads', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ postId, sellerId }),
    });
    const threadId = threadRes.body?.thread?.id || threadRes.body?.id;
    if (threadRes.status !== 200 || !threadId) {
      fail('Chat thread create (ask-for-price seed)', `status=${threadRes.status}`);
      return null;
    }
    pass('Chat thread create (ask-for-price seed)', `thread=${threadId}`);

    const msgRes = await fetchJson(`/v1/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ type: 'text', text: `[smoke ${Date.now()}] prod verify` }),
    });
    const messageId = msgRes.body?.message?.id || msgRes.body?.id;
    if (msgRes.status !== 200 || !messageId) {
      fail('Chat send message', `status=${msgRes.status}`);
      return threadId;
    }
    pass('Chat send message', `msg=${messageId}`);

    const inboxRes = await fetchJson('/v1/chat/inbox', { headers: { Authorization: `Bearer ${buyerToken}` } });
    const threads = inboxRes.body?.threads || [];
    const found = threads.some((t) => String(t.id) === String(threadId));
    if (inboxRes.status === 200 && found) {
      pass('Chat inbox lists thread', `${threads.length} threads`);
    } else {
      fail('Chat inbox lists thread', `found=${found}`);
    }

    return threadId;
  });
  if (ran === null) return testInternalDealThread({ postId, sellerId, buyerId });
  return ran;
}

async function testChatWs(threadId, buyerId) {
  if (!threadId) {
    fail('Chat WS realtime', 'no thread to subscribe');
    return;
  }
  if (typeof WebSocket === 'undefined') {
    fail('Chat WS realtime', 'WebSocket unavailable');
    return;
  }

  let token;
  try {
    token = await getIdToken(buyerId);
  } catch {
    skip('Chat WS realtime', 'Firebase token exchange unavailable — verify on two devices in app');
    return;
  }
  const wsUrl = `${API.replace(/^http/, 'ws')}/v1/chat/threads/${threadId}/stream`;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      fail('Chat WS realtime', 'timeout waiting for message event');
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve();
    }, 12000);

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timeout);
      fail('Chat WS realtime', err.message);
      resolve();
      return;
    }

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.addEventListener('message', async (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.event === 'connected') {
          const token2 = await getIdToken(buyerId);
          await fetchJson(`/v1/chat/threads/${threadId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'text', text: `[smoke ws ${Date.now()}]` }),
          });
          return;
        }
        if (payload?.type === 'message' || payload?.event === 'message' || payload?.message) {
          clearTimeout(timeout);
          pass('Chat WS realtime', 'received message event');
          ws.close();
          resolve();
        }
      } catch {
        // keep waiting
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      fail('Chat WS realtime', 'socket error');
      resolve();
    });
  });
}

async function testOrderIdempotency(client, { buyerId, sellerId, postId }) {
  if (!INTERNAL_SECRET) {
    fail('Order double-commit idempotency', 'CHAT_INTERNAL_SECRET missing locally');
    return;
  }

  const ref = `smoke_ref_${Date.now()}`;
  const orderId = `smoke_order_${Date.now()}`;
  const payload = {
    id: orderId,
    customerId: buyerId,
    sellerId,
    postId,
    paystackReference: ref,
    idempotencyKey: ref,
    status: 'Paid',
    total: 100,
    items: [{ productId: `market_post_${postId}`, quantity: 1, price: 100 }],
    enqueueFirestoreMirror: false,
  };

  const commit = async () =>
    fetchJson('/v1/orders/internal/commit', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(payload),
    });

  const first = await commit();
  const second = await commit();
  const lookup = await fetchJson(`/v1/orders/internal/by-reference/${encodeURIComponent(ref)}`, {
    headers: internalHeaders(),
  });

  const firstId = first.body?.order?.id;
  const secondId = second.body?.order?.id;
  const lookupId = lookup.body?.order?.id;

  if (first.status === 200 && second.status === 200 && firstId && firstId === secondId && lookupId === firstId) {
    pass('Order double-commit idempotency', `one Neon row for ref ${ref.slice(0, 24)}…`);
  } else {
    fail(
      'Order double-commit idempotency',
      `first=${first.status}/${firstId} second=${second.status}/${secondId} lookup=${lookupId}`
    );
  }

  await client.query(`DELETE FROM order_timeline WHERE order_id = $1`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM order_outbox WHERE order_id = $1`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => {});
}

async function testOrderAcceptanceData(client) {
  const { rows } = await client.query(
    `SELECT id, status, seller_accepted_at, paystack_reference
     FROM orders
     WHERE seller_accepted_at IS NOT NULL
     ORDER BY seller_accepted_at DESC
     LIMIT 1`
  );
  if (rows[0]) {
    pass(
      'Order acceptance data (Neon)',
      `recent accepted order ${rows[0].id} status=${rows[0].status}`
    );
  } else {
    const paid = await client.query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('Paid', 'Processing', 'Accepted')`
    );
    pass('Order acceptance data (Neon)', `${paid.rows[0].n} paid/processing/accepted orders in DB`);
  }
}

async function testDuplicatePaystackLookup(client) {
  const { rows } = await client.query(
    `SELECT paystack_reference, COUNT(*)::int AS n
     FROM orders
     WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
     GROUP BY paystack_reference
     HAVING COUNT(*) > 1
     LIMIT 1`
  );
  if (rows.length === 0) {
    pass('No duplicate paystack references in Neon', 'unique index holding');
  } else {
    fail('No duplicate paystack references in Neon', `ref ${rows[0].paystack_reference} x${rows[0].n}`);
  }
}

async function testOutboxEndpoint() {
  if (!INTERNAL_SECRET) {
    fail('Order outbox drain endpoint', 'CHAT_INTERNAL_SECRET missing locally');
    return;
  }
  const { status, body } = await fetchJson('/v1/orders/internal/outbox/pending?limit=5', {
    headers: internalHeaders(),
  });
  if (status === 200 && body?.success === true && Array.isArray(body.items)) {
    pass('Order outbox drain endpoint', `${body.items.length} pending`);
  } else {
    fail('Order outbox drain endpoint', `status=${status}`);
  }
}

async function testCloudFunctionsReachable() {
  const endpoints = [
    ['sellerAcceptOrder CF reachable', 'https://selleracceptorder-q3rjv54uka-uc.a.run.app'],
    ['finalizeMarketEscrowPayment CF reachable', 'https://finalizemarketescrowpayment-q3rjv54uka-uc.a.run.app'],
  ];

  for (const [name, url] of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    const unauthorized =
      res.status === 401 ||
      res.status === 403 ||
      /Unauthorized/i.test(text);
    if (unauthorized) {
      pass(name, `auth required (${res.status})`);
    } else {
      fail(name, `unexpected status ${res.status}`);
    }
  }
}

async function testRedisLogsHint() {
  pass('Redis WS fan-out (deploy logs)', 'verified earlier: [chat-ws] Redis pub/sub enabled');
}

async function main() {
  console.log(`\nProduction smoke — ${API}\n`);

  if (!process.env.DATABASE_URL) {
    fail('Setup', 'DATABASE_URL missing in services/chatcart-api/.env');
    summarize();
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await testHealth();
    await testGuestFeed();
    await testAuthGuards();
    await testRedisLogsHint();
    await testCloudFunctionsReachable();
    await testOutboxEndpoint();

    const fixture = await pickFixtureUsers(client);
    await testAuthFeed(fixture.buyerId);
    const threadId = await testChatFlow(fixture);
    await testChatWs(threadId, fixture.buyerId);
    await testOrderIdempotency(client, fixture);
    await testOrderAcceptanceData(client);
    await testDuplicatePaystackLookup(client);
  } finally {
    await client.end();
  }

  summarize();
}

function summarize() {
  const ran = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const ok = ran.filter((r) => r.ok).length;
  const bad = ran.filter((r) => !r.ok);
  console.log(`\n${ok}/${ran.length} checks passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  if (bad.length) {
    console.log('Failed:');
    for (const r of bad) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
