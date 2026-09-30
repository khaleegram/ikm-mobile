/**
 * Voice/video calls: the record of a call, the ringing, and the relay credentials.
 *
 * The media itself is peer-to-peer — WebRTC sends audio and video straight between the two phones.
 * This module never sees it. What it owns:
 *   - who is calling whom, and the fact that only one live call exists per person
 *   - short-lived TURN credentials, because a large share of mobile networks cannot be reached
 *     directly and the call would otherwise connect-then-die
 *   - ringing the other person, by socket if their app is open and by push if it is not
 */
import crypto from 'crypto';
import { getMessaging } from 'firebase-admin/messaging';

import { pool } from './db.mjs';
import { config } from './config.mjs';
import { getUserFcmTokens, getUser } from './users.mjs';
import { broadcastToUser, countUserSockets } from './chat-ws.mjs';

/** How long the far side rings before we call it a missed call. Matches the client's timer. */
export const RING_TIMEOUT_SEC = 45;

const CALL_SELECT = `
  SELECT id, thread_id, caller_id, callee_id, kind, status,
         started_at, answered_at, ended_at, duration_sec, ended_by
    FROM calls
`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    endedBy: row.ended_by,
  };
}

/**
 * Ring timeouts are resolved lazily rather than by a scheduled job.
 *
 * A call that nobody answered has to stop counting as "live" before either person can place
 * another one. Checking on the way in is enough — the unique indexes plus this sweep mean a
 * ring can never hold someone hostage.
 */
async function expireStaleRings(userIds) {
  if (!pool) return;
  await pool.query(
    `UPDATE calls
        SET status = 'missed', ended_at = now()
      WHERE status = 'ringing'
        AND started_at < now() - ($2 || ' seconds')::interval
        AND (caller_id = ANY($1) OR callee_id = ANY($1))`,
    [userIds, RING_TIMEOUT_SEC]
  );
}

async function findLiveCallFor(userId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `${CALL_SELECT}
      WHERE status IN ('ringing', 'active') AND (caller_id = $1 OR callee_id = $1)
      ORDER BY started_at DESC
      LIMIT 1`,
    [userId]
  );
  return shape(rows[0]);
}

export async function getCallById(callId) {
  if (!pool) return null;
  const { rows } = await pool.query(`${CALL_SELECT} WHERE id = $1 LIMIT 1`, [callId]);
  return shape(rows[0]);
}

export async function assertCallParticipant(userId, callId) {
  const call = await getCallById(callId);
  if (!call) {
    const error = new Error('Call not found');
    error.statusCode = 404;
    throw error;
  }
  if (call.callerId !== userId && call.calleeId !== userId) {
    const error = new Error('You are not part of this call');
    error.statusCode = 403;
    throw error;
  }
  return call;
}

/** The other person on the call. */
export function peerOf(call, userId) {
  return call.callerId === userId ? call.calleeId : call.callerId;
}

/**
 * Start ringing.
 *
 * Returns the live call if one already exists, so a double-tap or a retry joins the call already
 * in progress instead of placing a second one. If the other person is busy, `busy` comes back true
 * and the client says so plainly rather than ringing into nothing.
 */
export async function createCall({ threadId, callerId, calleeId, kind = 'audio' }) {
  if (!pool) throw new Error('Calls are unavailable right now');
  if (callerId === calleeId) throw new Error('You cannot call yourself');

  await expireStaleRings([callerId, calleeId]);

  const mine = await findLiveCallFor(callerId);
  if (mine) return { call: mine, reused: true, busy: mine.calleeId !== calleeId };

  const theirs = await findLiveCallFor(calleeId);
  if (theirs) return { call: theirs, reused: true, busy: true };

  const id = crypto.randomUUID();
  const safeKind = kind === 'video' ? 'video' : 'audio';
  try {
    const { rows } = await pool.query(
      `INSERT INTO calls (id, thread_id, caller_id, callee_id, kind, status)
       VALUES ($1, $2, $3, $4, $5, 'ringing')
       RETURNING id, thread_id, caller_id, callee_id, kind, status,
                 started_at, answered_at, ended_at, duration_sec, ended_by`,
      [id, threadId, callerId, calleeId, safeKind]
    );
    return { call: shape(rows[0]), reused: false, busy: false };
  } catch (error) {
    // The unique index fired: someone won the race to ring this person. Hand back the winner.
    if (String(error?.code) === '23505') {
      const live = (await findLiveCallFor(calleeId)) || (await findLiveCallFor(callerId));
      if (live) return { call: live, reused: true, busy: live.calleeId !== calleeId };
    }
    throw error;
  }
}

export async function answerCall(callId, userId) {
  if (!pool) throw new Error('Calls are unavailable right now');
  const { rows } = await pool.query(
    `UPDATE calls
        SET status = 'active', answered_at = coalesce(answered_at, now())
      WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
      RETURNING id, thread_id, caller_id, callee_id, kind, status,
                started_at, answered_at, ended_at, duration_sec, ended_by`,
    [callId, userId]
  );
  // No row means it already ended or was never ringing at this person — read back the truth.
  return shape(rows[0]) || (await getCallById(callId));
}

export async function declineCall(callId, userId) {
  if (!pool) throw new Error('Calls are unavailable right now');
  const { rows } = await pool.query(
    `UPDATE calls
        SET status = 'declined', ended_at = now(), ended_by = $2
      WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
      RETURNING id, thread_id, caller_id, callee_id, kind, status,
                started_at, answered_at, ended_at, duration_sec, ended_by`,
    [callId, userId]
  );
  return shape(rows[0]) || (await getCallById(callId));
}

/**
 * End or fail a call. Duration is only counted from the moment it was answered, so a call that
 * rang out reports as missed rather than as a zero-second conversation.
 */
export async function endCall(callId, userId, { failed = false } = {}) {
  if (!pool) throw new Error('Calls are unavailable right now');
  const { rows } = await pool.query(
    `UPDATE calls
        SET status = CASE
                       WHEN answered_at IS NULL THEN 'missed'
                       WHEN $3 THEN 'failed'
                       ELSE 'ended'
                     END,
            ended_at = now(),
            ended_by = $2,
            duration_sec = CASE
                             WHEN answered_at IS NULL THEN NULL
                             ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - answered_at))))::int
                           END
      WHERE id = $1 AND status IN ('ringing', 'active')
      RETURNING id, thread_id, caller_id, callee_id, kind, status,
                started_at, answered_at, ended_at, duration_sec, ended_by`,
    [callId, userId, failed]
  );
  return shape(rows[0]) || (await getCallById(callId));
}

/** Call history for a conversation, newest first. */
export async function listCallsForThread(threadId, limit = 30) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `${CALL_SELECT} WHERE thread_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [threadId, Math.min(Math.max(Number(limit) || 30, 1), 100)]
  );
  return rows.map(shape);
}

/**
 * Relay credentials, minted fresh per call.
 *
 * Direct connections fail behind carrier-grade NAT, which is most mobile networks — the call would
 * ring, connect, then drop. TURN relays the media for those. Credentials are short-lived on
 * purpose so a leaked one is worthless quickly: never ship a static TURN password in the app.
 */
let cachedIce = null;
let cachedIceUntil = 0;

export async function buildIceServers() {
  const stun = {
    urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  };

  // Static TURN, for a self-hosted coturn later.
  const staticTurn = [];
  if (config.turnUrls) {
    staticTurn.push({
      urls: config.turnUrls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      username: config.turnUsername,
      credential: config.turnCredential,
    });
  }

  if (config.turnKeyId && config.turnApiToken) {
    const now = Date.now();
    if (cachedIce && now < cachedIceUntil) {
      return { iceServers: [stun, ...staticTurn, ...cachedIce], turn: true };
    }
    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${config.turnKeyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.turnApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: config.turnTtlSec }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        const ice = data?.iceServers;
        // Cloudflare returns a single object; self-hosted setups may return a list.
        const list = Array.isArray(ice) ? ice : ice ? [ice] : [];
        if (list.length) {
          // Reuse briefly so a burst of calls does not hammer the provider, but never past its TTL.
          cachedIce = list;
          cachedIceUntil = now + Math.max(60, config.turnTtlSec - 120) * 1000;
          return { iceServers: [stun, ...staticTurn, ...list], turn: true };
        }
      } else {
        console.warn(`[calls] TURN credential request failed: ${response.status}`);
      }
    } catch (error) {
      console.warn('[calls] TURN credential request error:', error?.message || error);
    }
  }

  return { iceServers: [stun, ...staticTurn], turn: staticTurn.length > 0 };
}

async function displayNameFor(userId) {
  try {
    const user = await getUser(userId);
    const name = String(user?.storeName || '').trim() || String(user?.displayName || '').trim();
    if (name && !name.includes('@')) return name;
  } catch {
    // fall through
  }
  return 'Someone';
}

/**
 * Ring the other person.
 *
 * Both channels fire: the socket if their app is open (instant, in-app ringing screen), and push if
 * it is not. The push is a high-priority data message so the app can raise the call screen rather
 * than just a notification. Sending both is intentional — whichever lands first wins, and the
 * client de-duplicates by call id.
 */
export async function notifyIncomingCall({ call, callerId }) {
  const name = await displayNameFor(callerId);
  const payload = {
    type: 'incoming_call',
    callId: call.id,
    threadId: call.threadId,
    callerId,
    calleeId: call.calleeId,
    kind: call.kind,
    callerName: name,
  };

  broadcastToUser(call.calleeId, { event: 'incoming_call', ...payload });

  const tokens = await getUserFcmTokens(call.calleeId);
  if (!tokens.length) return { pushed: 0, reachable: countUserSockets(call.calleeId) };

  const title = call.kind === 'video' ? `${name} is video calling` : `${name} is calling`;
  const messaging = getMessaging();
  try {
    await messaging.sendEach(
      tokens.map((token) => ({
        token,
        // Data-only: the OS must not draw a plain notification, because the app shows a call screen.
        data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])),
        android: {
          priority: 'high',
          ttl: RING_TIMEOUT_SEC * 1000,
        },
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
          payload: { aps: { 'content-available': 1, sound: 'default' } },
        },
      }))
    );
  } catch (error) {
    console.error('[calls] incoming-call push failed:', error?.message || error);
  }
  return { pushed: tokens.length, reachable: countUserSockets(call.calleeId) };
}

/** Tell the other side the call is over so their screen closes without waiting for a timeout. */
export function notifyCallEnded({ call, reason, endedBy }) {
  const target = endedBy === call.callerId ? call.calleeId : call.callerId;
  broadcastToUser(target, {
    event: 'call_ended',
    callId: call.id,
    threadId: call.threadId,
    reason: reason || call.status,
    durationSec: call.durationSec ?? null,
  });
}
