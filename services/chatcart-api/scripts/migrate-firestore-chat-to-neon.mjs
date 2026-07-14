/**
 * Migrate legacy Firestore chat data into Neon Postgres deal threads.
 *
 * Usage:
 *   node scripts/migrate-firestore-chat-to-neon.mjs --dry-run
 *   node scripts/migrate-firestore-chat-to-neon.mjs
 *   node scripts/migrate-firestore-chat-to-neon.mjs --verify
 */
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { firestore } from '../src/firebase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verifyOnly = args.has('--verify');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const legacyMapPath = path.join(__dirname, 'legacy-thread-map.json');
const legacyMap = fs.existsSync(legacyMapPath)
  ? JSON.parse(fs.readFileSync(legacyMapPath, 'utf8'))
  : {};

function asString(value) {
  return String(value ?? '').trim();
}

function parseDirectConversation(convId) {
  if (!convId.startsWith('direct_')) return null;
  const parts = convId.split('_');
  if (parts.length !== 3) return null;
  return { userA: parts[1], userB: parts[2] };
}

async function ensureUsers(client, ids) {
  for (const id of ids) {
    if (!id) continue;
    if (dryRun) continue;
    await client.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
  }
}

async function migrateConversationDoc(convSnap) {
  const convId = convSnap.id;
  const data = convSnap.data() || {};
  const parsed = parseDirectConversation(convId);
  if (!parsed) return { skipped: 1 };

  const postId = asString(data.lastContextPostId || data.postId);
  if (!postId) return { skipped: 1 };

  const buyerId = parsed.userA;
  const sellerId = parsed.userB;
  const participantIds = Array.isArray(data.participantIds) ? data.participantIds : [];
  const resolvedBuyer =
    participantIds.find((id) => id !== sellerId) || buyerId;
  const resolvedSeller =
    participantIds.find((id) => id !== resolvedBuyer) || sellerId;

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    await ensureUsers(client, [resolvedBuyer, resolvedSeller]);

    let threadId = legacyMap[convId];
    if (!threadId && !dryRun) {
      const existing = await client.query(
        `SELECT id FROM chat_threads
         WHERE post_id = $1 AND buyer_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [postId, resolvedBuyer]
      );
      threadId = existing.rows[0]?.id;
    }

    if (!threadId && !dryRun) {
      const inserted = await client.query(
        `INSERT INTO chat_threads (post_id, buyer_id, seller_id, status, post_snapshot, last_message, last_at)
         VALUES ($1, $2, $3, 'browsing', '{}'::jsonb, $4, $5)
         RETURNING id`,
        [
          postId,
          resolvedBuyer,
          resolvedSeller,
          asString(data.lastMessage?.text || data.lastMessage || ''),
          data.updatedAt?.toDate?.() || new Date(),
        ]
      );
      threadId = inserted.rows[0].id;
      legacyMap[convId] = threadId;
    }

    const messagesSnap = await convSnap.ref.collection('messages').orderBy('createdAt', 'asc').get();
    let messageCount = 0;

    for (const msgDoc of messagesSnap.docs) {
      const msg = msgDoc.data() || {};
      const senderId = asString(msg.senderId);
      const body = asString(msg.text || msg.message || msg.body);
      const createdAt = msg.createdAt?.toDate?.() || new Date();
      const clientMsgId = asString(msg.clientMessageId) || null;
      const type = asString(msg.type) || 'text';

      if (!dryRun && threadId) {
        await client.query(
          `INSERT INTO chat_messages (thread_id, sender_id, type, body, payload, client_msg_id, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT (client_msg_id) DO NOTHING`,
          [
            threadId,
            senderId || null,
            type,
            body || null,
            JSON.stringify(
              msg.quoteCard
                ? {
                    postId: asString(msg.quoteCard.postId),
                    previewText: asString(msg.quoteCard.previewText),
                    previewImage: asString(msg.quoteCard.previewImage) || null,
                  }
                : {}
            ),
            clientMsgId,
            createdAt,
          ]
        );
      }
      messageCount += 1;
    }

    if (!dryRun && threadId) {
      await client.query(
        `INSERT INTO chat_inbox (user_id, thread_id, peer_id, unread_count, last_preview, last_at)
         VALUES ($1, $2, $3, 0, $4, now())
         ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [resolvedBuyer, threadId, resolvedSeller, asString(data.lastMessage?.text || '')]
      );
      await client.query(
        `INSERT INTO chat_inbox (user_id, thread_id, peer_id, unread_count, last_preview, last_at)
         VALUES ($1, $2, $3, 0, $4, now())
         ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [resolvedSeller, threadId, resolvedBuyer, asString(data.lastMessage?.text || '')]
      );
      await client.query('COMMIT');
    }

    return { threads: threadId ? 1 : 0, messages: messageCount };
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verify() {
  const threads = await pool.query(`SELECT COUNT(*)::int AS count FROM chat_threads`);
  const messages = await pool.query(`SELECT COUNT(*)::int AS count FROM chat_messages`);
  const inbox = await pool.query(`SELECT COUNT(*)::int AS count FROM chat_inbox`);
  console.log('Verify:', {
    threads: threads.rows[0]?.count,
    messages: messages.rows[0]?.count,
    inbox: inbox.rows[0]?.count,
    legacyMapEntries: Object.keys(legacyMap).length,
  });
}

async function migrateMarketChatDoc(chatSnap) {
  const chatId = chatSnap.id;
  const data = chatSnap.data() || {};
  const buyerId = asString(data.buyerId);
  const sellerId = asString(data.posterId || data.sellerId);
  const postId = asString(data.postId || data.marketPostId);
  if (!buyerId || !sellerId || !postId) return { skipped: 1 };

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    await ensureUsers(client, [buyerId, sellerId]);

    let threadId = legacyMap[chatId];
    if (!threadId && !dryRun) {
      const existing = await client.query(
        `SELECT id FROM chat_threads
         WHERE post_id = $1 AND buyer_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [postId, buyerId]
      );
      threadId = existing.rows[0]?.id;
    }

    if (!threadId && !dryRun) {
      const inserted = await client.query(
        `INSERT INTO chat_threads (post_id, buyer_id, seller_id, status, post_snapshot, last_message, last_at)
         VALUES ($1, $2, $3, 'browsing', '{}'::jsonb, $4, $5)
         RETURNING id`,
        [
          postId,
          buyerId,
          sellerId,
          asString(data.lastMessage || data.lastMessageText || ''),
          data.updatedAt?.toDate?.() || data.lastMessageAt?.toDate?.() || new Date(),
        ]
      );
      threadId = inserted.rows[0].id;
      legacyMap[chatId] = threadId;
    }

    const messagesSnap = await chatSnap.ref.collection('messages').orderBy('createdAt', 'asc').get();
    let messageCount = 0;

    for (const msgDoc of messagesSnap.docs) {
      const msg = msgDoc.data() || {};
      const senderId = asString(msg.senderId || msg.senderUid || msg.fromUserId);
      const body = asString(msg.text || msg.message || msg.body);
      const createdAt = msg.createdAt?.toDate?.() || new Date();
      const clientMsgId = asString(msg.clientMessageId) || null;
      const type = asString(msg.type) || 'text';
      const quote = msg.quoteCard || {};

      if (!dryRun && threadId) {
        await client.query(
          `INSERT INTO chat_messages (thread_id, sender_id, type, body, payload, client_msg_id, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT (client_msg_id) DO NOTHING`,
          [
            threadId,
            senderId || null,
            type,
            body || null,
            JSON.stringify(
              quote.postId
                ? {
                    postId: asString(quote.postId),
                    previewText: asString(quote.previewText),
                    previewImage: asString(quote.previewImage) || null,
                  }
                : {}
            ),
            clientMsgId,
            createdAt,
          ]
        );
      }
      messageCount += 1;
    }

    if (!dryRun && threadId) {
      await client.query(
        `INSERT INTO chat_inbox (user_id, thread_id, peer_id, unread_count, last_preview, last_at)
         VALUES ($1, $2, $3, 0, $4, now())
         ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [buyerId, threadId, sellerId, asString(data.lastMessage || '')]
      );
      await client.query(
        `INSERT INTO chat_inbox (user_id, thread_id, peer_id, unread_count, last_preview, last_at)
         VALUES ($1, $2, $3, 0, $4, now())
         ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [sellerId, threadId, buyerId, asString(data.lastMessage || '')]
      );
      await client.query('COMMIT');
    }

    return { threads: threadId ? 1 : 0, messages: messageCount };
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (verifyOnly) {
    await verify();
    await pool.end();
    return;
  }

  const convSnap = await firestore.collection('conversations').get();
  let threads = 0;
  let messages = 0;
  let skipped = 0;

  for (const doc of convSnap.docs) {
    const result = await migrateConversationDoc(doc);
    threads += result.threads || 0;
    messages += result.messages || 0;
    skipped += result.skipped || 0;
  }

  const marketChatsSnap = await firestore.collection('marketChats').get();
  let mcThreads = 0;
  let mcMessages = 0;
  let mcSkipped = 0;

  for (const doc of marketChatsSnap.docs) {
    const result = await migrateMarketChatDoc(doc);
    mcThreads += result.threads || 0;
    mcMessages += result.messages || 0;
    mcSkipped += result.skipped || 0;
  }

  if (!dryRun) {
    fs.writeFileSync(legacyMapPath, JSON.stringify(legacyMap, null, 2));
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}Migrated conversations: threads=${threads}, messages=${messages}, skipped=${skipped}`
  );
  console.log(
    `${dryRun ? '[dry-run] ' : ''}Migrated marketChats: threads=${mcThreads}, messages=${mcMessages}, skipped=${mcSkipped}`
  );
  await verify();
  await pool.end();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
