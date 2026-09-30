import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.mjs';
import { requireAuth } from './auth.mjs';
import { buildPersonalizedFeed, buildFollowingFeed, buildPublicFeed } from './feed.mjs';
import {
  likePost,
  unlikePost,
  markPostsSeen,
  recordWatchSession,
  recordAction,
  refreshScoreDecay,
} from './social.mjs';
import {
  createPresignedUpload,
  deleteMediaForUser,
  processOriginalMarketSound,
} from './media.mjs';
import {
  createPost,
  updatePost,
  deleteMarketPost,
  getPostById,
  getPostsBatch,
  listPostsBySound,
  listTrendingHashtags,
  searchPosts,
} from './posts.mjs';
import {
  getSoundById,
  listSounds,
  listSavedSounds,
  listSavedSoundIds,
  isSoundSaved,
  saveSound,
  unsaveSound,
} from './sounds.mjs';
import {
  listOrdersForUser,
  getOrderById,
  assertOrderAccess,
  upsertOrderFromPayload,
  appendTimelineEvent,
  bumpPostPurchaseCount,
  commitOrderFromPayload,
  listPendingOrderOutbox,
  ackOrderOutbox,
  failOrderOutbox,
  getOrderByPaystackReference,
  listOrdersByPaystackReference,
  listOrdersByCheckoutPaymentId,
  upsertCheckoutPaymentFromPayload,
  getCheckoutPaymentByReference,
  getOrderByDealThreadId,
} from './orders.mjs';
import {
  followUser,
  unfollowUser,
  isFollowing,
  savePost,
  unsavePost,
  listSavedPostIds,
  listLikedPostIds,
  blockUser,
  unblockUser,
  listBlockedIds,
  listComments,
  createComment,
  deleteComment,
  listFollowingIds,
  listFollowerIds,
} from './social-graph.mjs';
import { getUser, getUsersBatch, updateUser, registerFcmToken, unregisterFcmToken, searchUsers } from './users.mjs';
import {
  getInbox,
  getOrCreateThread,
  getThread,
  getMessages,
  sendMessage,
  createOffer,
  respondToOffer,
  markThreadRead,
  reportMessage,
  searchMessages,
  appendSystemEvent,
  assertThreadParticipant,
  ensureDealThreadForOrder,
} from './chat.mjs';
import {
  registerThreadSocket,
  unregisterThreadSocket,
  initChatWsPubSub,
  registerUserSocket,
  unregisterUserSocket,
  broadcastToUser,
} from './chat-ws.mjs';
import {
  RING_TIMEOUT_SEC,
  assertCallParticipant,
  answerCall,
  buildIceServers,
  createCall,
  declineCall,
  endCall,
  listCallsForThread,
  notifyIncomingCall,
  peerOf,
} from './calls.mjs';
import { touchPresence } from './chat-presence.mjs';
import { requireAdmin } from './auth.mjs';
import { createRateCard, listRateCards, resolveRateCard } from './commission.mjs';
import {
  archiveCampaign,
  createCampaign,
  decidePayoutReview,
  describeCampaign,
  ensureBaselineTicket,
  getCampaign,
  getPromoReport,
  listBudgetLedger,
  listCampaigns,
  listLiveCampaigns,
  listPendingPayoutReviews,
  promoStatusFor,
  quotePromoOrder,
  recordVerifiedIdentity,
  reconcileReservedBalance,
  setCampaignEnabled,
  updateCampaign,
} from './promo.mjs';
import { createReferral, getReferralProgress } from './referrals.mjs';
import {
  cancelPayout,
  finalizeCheckout,
  finalizePayout,
  getChargeTruth,
  getSellerEarnings,
  groupCartBySeller,
  handlePaystackWebhook,
  initializeTransaction,
  listBanks,
  listPayouts,
  requestPayout,
  resolveAccount,
  savePayoutDetails,
  verifyTransaction,
} from './payments.mjs';
import { quoteCheckout } from './checkout-quote.mjs';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigins });
await app.register(websocket);

app.get('/health', async () => ({ ok: true, service: 'chatcart-api' }));

// ─── Chat (Deal Threads) ───────────────────────────────────────────────────

app.get('/v1/chat/inbox', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await getInbox(auth.uid);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/threads', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await getOrCreateThread(auth.uid, {
      postId: request.body?.postId,
      sellerId: request.body?.sellerId,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/chat/threads/:id', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await getThread(auth.uid, request.params.id);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/chat/threads/:id/messages', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await getMessages(auth.uid, request.params.id, {
      before: request.query?.before,
      limit: request.query?.limit,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/threads/:id/messages', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await sendMessage(auth.uid, request.params.id, request.body || {});
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/threads/:id/offers', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await createOffer(auth.uid, request.params.id, request.body || {});
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.patch('/v1/chat/threads/:id/offers/:offerId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await respondToOffer(
      auth.uid,
      request.params.id,
      request.params.offerId,
      request.body?.action,
      request.body || {}
    );
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/threads/:id/read', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await touchPresence(auth.uid);
    const result = await markThreadRead(auth.uid, request.params.id);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/threads/:id/messages/:msgId/report', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await reportMessage(
      auth.uid,
      request.params.id,
      request.params.msgId,
      request.body?.reason
    );
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/chat/search', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await searchMessages(auth.uid, {
      q: request.query?.q,
      threadId: request.query?.threadId,
      limit: request.query?.limit,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/internal/system-event', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const result = await appendSystemEvent({
      threadId: request.body?.threadId,
      orderId: request.body?.orderId,
      event: request.body?.event,
      text: request.body?.text,
      photoUrl: request.body?.photoUrl || request.body?.sentPhotoUrl || request.body?.imageUrl,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/chat/internal/ensure-deal-thread', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const result = await ensureDealThreadForOrder({
      buyerId: request.body?.buyerId,
      postId: request.body?.postId,
      sellerId: request.body?.sellerId,
      threadId: request.body?.threadId || request.body?.dealThreadId,
    });
    return reply.send({ success: true, threadId: result.thread.id, thread: result.thread, isNew: result.isNew });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

function asString(value) {
  return String(value ?? '').trim();
}

/**
 * End a call, tell the other side, and record it in the conversation — once.
 *
 * Both the socket and the REST route funnel through here so hanging up behaves identically
 * whichever path the client takes, and so a call can never be written into the chat twice.
 */
async function finishCall({ callId, userId, failed = false }) {
  const before = await assertCallParticipant(userId, callId);
  const call = await endCall(callId, userId, { failed });

  broadcastToUser(peerOf(call, userId), {
    event: 'call_ended',
    callId: call.id,
    reason: call?.status || 'ended',
    durationSec: call?.durationSec ?? null,
  });

  const wasOpen = before.status === 'ringing' || before.status === 'active';
  if (wasOpen && call?.threadId) {
    const seconds = Number(call.durationSec || 0);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const length = mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
    const text =
      call.status === 'ended'
        ? `${call.kind === 'video' ? 'Video' : 'Voice'} call · ${length}`
        : call.status === 'declined'
          ? 'Call declined'
          : 'Missed call';
    await appendSystemEvent({ threadId: call.threadId, event: 'call', text }).catch(() => {});
  }

  return call;
}

app.get('/v1/chat/threads/:id/stream', { websocket: true }, (socket, request) => {
  const threadId = request.params?.id;
  let authedUserId = null;

  socket.on('message', async (raw) => {
    try {
      const parsed = JSON.parse(String(raw));
      if (parsed?.type === 'auth') {
        const auth = await requireAuth(`Bearer ${parsed.token || ''}`);
        await assertThreadParticipant(auth.uid, threadId);
        authedUserId = auth.uid;
        await touchPresence(auth.uid);
        registerThreadSocket(threadId, socket);
        socket.send(JSON.stringify({ event: 'connected', threadId }));
        return;
      }
      if (parsed?.type === 'ping') {
        if (authedUserId) await touchPresence(authedUserId);
        socket.send(JSON.stringify({ event: 'pong' }));
      }
    } catch (error) {
      socket.send(JSON.stringify({ event: 'error', message: error.message }));
    }
  });

  socket.on('close', () => {
    unregisterThreadSocket(threadId, socket);
  });
});

/**
 * Call channel — one socket per person, not per conversation.
 *
 * A call has to reach you wherever you are in the app, so this socket is keyed by user. After the
 * auth handshake it only relays signalling between the two people on a live call: the server looks
 * up the call, works out the peer, and forwards. Signals are never relayed to anyone the sender is
 * not already on a call with.
 */
app.get('/v1/calls/stream', { websocket: true }, (socket, request) => {
  let authedUserId = null;

  const fail = (message) => socket.send(JSON.stringify({ event: 'error', message }));

  socket.on('message', async (raw) => {
    try {
      const parsed = JSON.parse(String(raw));

      if (parsed?.type === 'auth') {
        const auth = await requireAuth(`Bearer ${parsed.token || ''}`);
        authedUserId = auth.uid;
        await touchPresence(auth.uid);
        registerUserSocket(auth.uid, socket);
        socket.send(JSON.stringify({ event: 'connected', userId: auth.uid }));
        return;
      }

      if (!authedUserId) {
        fail('Not authenticated');
        return;
      }

      if (parsed?.type === 'ping') {
        await touchPresence(authedUserId);
        socket.send(JSON.stringify({ event: 'pong' }));
        return;
      }

      // Signal / state changes. `type` doubles as the event name sent to the peer.
      const relayable = ['offer', 'answer', 'ice', 'accept', 'decline', 'end'];
      if (!relayable.includes(String(parsed?.type))) return;

      const call = await assertCallParticipant(authedUserId, parsed?.callId);
      const peer = peerOf(call, authedUserId);

      if (parsed.type === 'accept') {
        const updated = await answerCall(call.id, authedUserId);
        broadcastToUser(peer, { event: 'call_accepted', callId: call.id });
        return;
      }
      if (parsed.type === 'decline') {
        await declineCall(call.id, authedUserId);
        broadcastToUser(peer, { event: 'call_declined', callId: call.id });
        return;
      }
      if (parsed.type === 'end') {
        await finishCall({ callId: call.id, userId: authedUserId });
        return;
      }

      // offer / answer / ice — opaque to us, passed straight through.
      broadcastToUser(peer, {
        event: parsed.type,
        callId: call.id,
        threadId: call.threadId,
        from: authedUserId,
        payload: parsed.payload ?? null,
      });
    } catch (error) {
      fail(error.message);
    }
  });

  socket.on('close', () => {
    if (authedUserId) unregisterUserSocket(authedUserId, socket);
  });
});

/** Relay credentials for a call. Short-lived, minted server-side so nothing is baked into the app. */
app.get('/v1/calls/ice', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const ice = await buildIceServers();
    return reply.send({ success: true, ...ice });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** Place a call. Rings the other person by socket and by push. */
app.post('/v1/calls', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const body = request.body || {};
    const threadId = asString(body.threadId);
    const calleeId = asString(body.calleeId) || asString(body.calleeUserId);
    if (!threadId || !calleeId) {
      return reply.code(400).send({ success: false, error: 'threadId and calleeId are required' });
    }

    // Only people actually in the conversation may ring each other.
    await assertThreadParticipant(auth.uid, threadId);

    const { call, reused, busy } = await createCall({
      threadId,
      callerId: auth.uid,
      calleeId,
      kind: body.kind,
    });

    if (busy) {
      return reply.send({ success: true, busy: true, call, ice: null });
    }

    const ice = await buildIceServers();
    if (!reused) await notifyIncomingCall({ call, callerId: auth.uid });

    return reply.send({ success: true, busy: false, call, ice, ringTimeoutSec: RING_TIMEOUT_SEC });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** Current state of a call — used when a screen reopens or a socket reconnects mid-call. */
app.get('/v1/calls/:id', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const call = await assertCallParticipant(auth.uid, request.params?.id);
    return reply.send({ success: true, call });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/calls/:id/answer', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await assertCallParticipant(auth.uid, request.params?.id);
    const call = await answerCall(request.params.id, auth.uid);
    broadcastToUser(peerOf(call, auth.uid), { event: 'call_accepted', callId: call.id });
    return reply.send({ success: true, call });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/calls/:id/decline', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    await assertCallParticipant(auth.uid, request.params?.id);
    const call = await declineCall(request.params.id, auth.uid);
    broadcastToUser(peerOf(call, auth.uid), { event: 'call_declined', callId: call.id });
    return reply.send({ success: true, call });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * Hang up.
 *
 * Also writes a line into the conversation, so a call is part of the deal's history rather than
 * something that vanished. A missed or declined call is exactly what a later dispute needs to see.
 */
app.post('/v1/calls/:id/end', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const call = await finishCall({
      callId: request.params?.id,
      userId: auth.uid,
      failed: Boolean(request.body?.failed),
    });
    return reply.send({ success: true, call });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/calls/thread/:threadId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const threadId = asString(request.params?.threadId);
    await assertThreadParticipant(auth.uid, threadId);
    const calls = await listCallsForThread(threadId, request.query?.limit);
    return reply.send({ success: true, calls });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/feed', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const body = request.body || {};
    const result = await buildPersonalizedFeed(auth.uid, {
      limit: body.limit,
      cursor: body.cursor,
      session_id: body.session_id ?? body.sessionId,
      excludePostIds: body.excludePostIds,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/feed/following', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await buildFollowingFeed(auth.uid, {
      limit: request.query?.limit,
      cursor: request.query?.cursor,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/feed/public', async (request, reply) => {
  try {
    const result = await buildPublicFeed({
      limit: request.query?.limit,
      cursor: request.query?.cursor,
      session_id: request.query?.session_id ?? request.query?.sessionId,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/feed/seen', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await markPostsSeen(
      auth.uid,
      request.body?.postIds,
      request.body?.dwellSec
    );
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/watch', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await recordWatchSession(auth.uid, request.body || {});
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/action', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const postId = request.body?.postId;
    const actionType = request.body?.actionType;
    const result = await recordAction(auth.uid, postId, actionType);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/like', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await likePost(auth.uid, request.body?.postId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/social/like/:postId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unlikePost(auth.uid, request.params.postId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/admin/refresh-scores', async (request, reply) => {
  const limit = Number(request.body?.limit || 500);
  const count = await refreshScoreDecay(limit);
  return reply.send({ success: true, refreshed: count });
});

app.post('/v1/media/presign', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await createPresignedUpload({
      uid: auth.uid,
      storagePath: request.body?.path,
      contentType: request.body?.contentType,
      contentLength: Number(request.body?.contentLength || 0) || undefined,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/media/delete', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await deleteMediaForUser(auth.uid, request.body?.paths);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/media/process-video', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await processOriginalMarketSound({
      uid: auth.uid,
      postId: request.body?.postId,
      videoPath: request.body?.videoPath,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/posts', async (request, reply) => {
  try {
    // Public catalog: browse a store's listings or posts using a sound.
    // Auth is optional — when present we still only return active posts.
    const posterId = String(request.query?.posterId || '').trim();
    const soundId = String(request.query?.soundId || '').trim();
    if (!posterId && !soundId) {
      return reply.code(400).send({ success: false, error: 'posterId or soundId is required' });
    }
    const limit = Math.min(60, Math.max(1, Number(request.query?.limit || 40)));
    if (soundId) {
      const posts = await listPostsBySound(soundId, limit);
      return reply.send({ success: true, posts });
    }
    const { pool } = await import('./db.mjs');
    if (!pool) {
      return reply.code(503).send({ success: false, error: 'Database is not configured' });
    }
    const { rows } = await pool.query(
      `SELECT id FROM posts WHERE poster_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT $2`,
      [posterId, limit]
    );
    const posts = await getPostsBatch(rows.map((r) => r.id));
    return reply.send({ success: true, posts });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/posts/batch', async (request, reply) => {
  try {
    // Public hydrate for active posts (feed / store grids).
    const raw = String(request.query?.ids || '');
    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 50);
    const posts = (await getPostsBatch(ids)).filter((p) => String(p?.status || '') === 'active');
    return reply.send({ success: true, posts });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/posts/search', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const q = String(request.query?.q || '').trim();
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 50)));
    const posts = await searchPosts(q, limit);
    return reply.send({ success: true, posts });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/trending-hashtags', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 30)));
    const hashtags = await listTrendingHashtags(limit);
    return reply.send({ success: true, hashtags });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/posts/:postId', async (request, reply) => {
  try {
    // Active posts are publicly readable; hidden/deleted stay private.
    const post = await getPostById(request.params.postId);
    if (!post) return reply.code(404).send({ success: false, error: 'Post not found' });
    if (String(post.status || '') !== 'active') {
      // Owner can still fetch non-active via authenticated path later if needed
      try {
        const auth = await requireAuth(request.headers.authorization);
        if (auth.uid !== String(post.posterId || '')) {
          return reply.code(404).send({ success: false, error: 'Post not found' });
        }
      } catch {
        return reply.code(404).send({ success: false, error: 'Post not found' });
      }
    }
    return reply.send({ success: true, post });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/posts', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const post = await createPost(auth.uid, request.body || {});
    return reply.code(201).send({ success: true, post });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.patch('/v1/posts/:postId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const post = await updatePost(auth.uid, request.params.postId, request.body || {});
    return reply.send({ success: true, post });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/posts/:postId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await deleteMarketPost(auth.uid, request.params.postId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/sounds', async (request, reply) => {
  try {
    const sounds = await listSounds({
      limit: Number(request.query?.limit || 60),
      q: String(request.query?.q || ''),
    });
    return reply.send({ success: true, sounds });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/sounds/saved', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const sounds = await listSavedSounds(auth.uid, Number(request.query?.limit || 150));
    return reply.send({ success: true, sounds });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/sounds/saved/ids', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const ids = await listSavedSoundIds(auth.uid, Number(request.query?.limit || 150));
    return reply.send({ success: true, ids });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/sounds/:soundId', async (request, reply) => {
  try {
    const sound = await getSoundById(request.params.soundId);
    if (!sound) {
      return reply.code(404).send({ success: false, error: 'Sound not found' });
    }
    let saved = false;
    if (request.headers.authorization) {
      try {
        const auth = await requireAuth(request.headers.authorization);
        saved = await isSoundSaved(auth.uid, sound.id);
      } catch {
        saved = false;
      }
    }
    return reply.send({ success: true, sound, saved });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/sounds/:soundId/save', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await saveSound(auth.uid, request.params.soundId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/sounds/:soundId/save', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unsaveSound(auth.uid, request.params.soundId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/follow', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await followUser(auth.uid, request.body?.userId || request.body?.followedId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/social/follow/:userId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unfollowUser(auth.uid, request.params.userId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/following', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const forUserId = String(request.query?.userId || '').trim() || auth.uid;
    const ids = await listFollowingIds(forUserId);
    return reply.send({ success: true, ids });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/followers', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const forUserId = String(request.query?.userId || '').trim() || auth.uid;
    const ids = await listFollowerIds(forUserId);
    return reply.send({ success: true, ids });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/followers/:userId', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const ids = await listFollowerIds(request.params.userId);
    return reply.send({ success: true, ids });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/following/:userId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const following = await isFollowing(auth.uid, request.params.userId);
    return reply.send({ success: true, following });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/save', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await savePost(auth.uid, request.body?.postId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/social/save/:postId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unsavePost(auth.uid, request.params.postId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/saved', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const ids = await listSavedPostIds(auth.uid, Number(request.query?.limit || 100));
    const posts = await getPostsBatch(ids);
    return reply.send({ success: true, ids, posts });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/liked', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const ids = await listLikedPostIds(auth.uid, Number(request.query?.limit || 300));
    const posts = await getPostsBatch(ids);
    return reply.send({ success: true, ids, posts });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/social/block', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await blockUser(auth.uid, request.body?.userId || request.body?.blockedId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/social/block/:userId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unblockUser(auth.uid, request.params.userId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/social/blocked', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const ids = await listBlockedIds(auth.uid);
    return reply.send({ success: true, ids });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/posts/:postId/comments', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const comments = await listComments(request.params.postId, {
      limit: request.query?.limit,
      before: request.query?.before,
    });
    return reply.send({ success: true, comments });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/posts/:postId/comments', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const comment = await createComment(
      auth.uid,
      request.params.postId,
      request.body?.text || request.body?.body
    );
    return reply.code(201).send({ success: true, comment });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/comments/:commentId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await deleteComment(auth.uid, request.params.commentId);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/users/me', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const user = await getUser(auth.uid);
    return reply.send({ success: true, user });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.patch('/v1/users/me', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const user = await updateUser(auth.uid, request.body || {});
    return reply.send({ success: true, user });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// Must be registered before /v1/users/:userId so "search" / "batch" are not captured as a userId.
app.get('/v1/users/search', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const users = await searchUsers({
      q: request.query?.q,
      city: request.query?.city,
      state: request.query?.state,
      limit: Number(request.query?.limit || 40),
    });
    return reply.send({ success: true, users });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/users/batch', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const raw = String(request.query?.ids || '').trim();
    const ids = raw
      ? raw.split(',').map((id) => id.trim()).filter(Boolean)
      : Array.isArray(request.query?.id)
        ? request.query.id.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    const users = await getUsersBatch(ids);
    return reply.send({ success: true, users });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/users/:userId', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const user = await getUser(request.params.userId);
    return reply.send({ success: true, user });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/users/me/fcm-token', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await registerFcmToken(auth.uid, request.body?.token);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.delete('/v1/users/me/fcm-token', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const token =
      request.body?.token ||
      request.query?.token ||
      null;
    const result = await unregisterFcmToken(auth.uid, token);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// Prefer POST unregister — fetch DELETE often cannot send a JSON body on React Native.
app.post('/v1/users/me/fcm-token/unregister', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await unregisterFcmToken(auth.uid, request.body?.token);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const role = String(request.query?.role || 'all').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 40)));
    const cursor = request.query?.cursor || null;
    const result = await listOrdersForUser(auth.uid, { role, limit, cursor });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders/by-thread/:threadId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const order = await getOrderByDealThreadId(request.params.threadId, { includeTimeline: true });
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    await assertOrderAccess(order, auth.uid);
    return reply.send({ success: true, order, timeline: order.timeline || [] });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders/:orderId', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const order = await getOrderById(request.params.orderId, { includeTimeline: true });
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    await assertOrderAccess(order, auth.uid);
    return reply.send({ success: true, order, timeline: order.timeline || [] });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// Internal (service-to-service) user read — lets Cloud Functions read buyer
// profile fields (phone, location, display name) from Neon at order-creation
// time instead of depending on a Firestore mirror of the users doc.
app.get('/v1/users/internal/:userId', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const user = await getUser(asString(request.params.userId));
    return reply.send({ success: true, user });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/orders/internal/upsert', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const order = await upsertOrderFromPayload(request.body || {});
    if (request.body?.bumpPurchaseCount && (request.body?.postId || request.body?.post_id)) {
      await bumpPostPurchaseCount(
        request.body.postId || request.body.post_id,
        request.body.customerId || request.body.customer_id
      ).catch(() => {});
    }
    return reply.send({ success: true, order });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** Neon write primary: order + timeline + firestore outbox in one transaction. */
app.post('/v1/orders/internal/commit', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const result = await commitOrderFromPayload(request.body || {});
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders/internal/by-reference/:reference', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const orders = await listOrdersByPaystackReference(request.params.reference);
    const checkout = await getCheckoutPaymentByReference(request.params.reference);
    // Backward compat: `order` = first child; prefer `orders` for multi-seller.
    return reply.send({
      success: true,
      order: orders[0] || null,
      orders,
      checkout,
      orderIds: orders.map((o) => o.id),
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/checkout-payments/internal/upsert', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const checkout = await upsertCheckoutPaymentFromPayload(request.body || {});
    return reply.send({ success: true, checkout });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/checkout-payments/internal/by-reference/:reference', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const checkout = await getCheckoutPaymentByReference(request.params.reference);
    const orders = checkout?.id
      ? await listOrdersByCheckoutPaymentId(checkout.id)
      : await listOrdersByPaystackReference(request.params.reference);
    return reply.send({ success: true, checkout, orders, orderIds: orders.map((o) => o.id) });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders/internal/outbox/pending', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const items = await listPendingOrderOutbox({ limit: request.query?.limit });
    return reply.send({ success: true, items });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/orders/internal/outbox/ack', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const ids = request.body?.ids || request.body?.id;
    const result = await ackOrderOutbox(ids);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/orders/internal/outbox/fail', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const ids = request.body?.ids || request.body?.id;
    const result = await failOrderOutbox(ids, request.body?.error || request.body?.message);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/orders/internal/:orderId', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const order = await getOrderById(request.params.orderId, { includeTimeline: true });
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    return reply.send({ success: true, order });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/orders/internal/timeline', async (request, reply) => {
  try {
    const secret = asString(request.headers['x-chat-internal-secret']);
    if (!config.chatInternalSecret || secret !== config.chatInternalSecret) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const result = await appendTimelineEvent(request.body || {});
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * Price a cart, for the buyer's breakdown before paying.
 *
 * Read-only and side-effect free: it charges nothing and records nothing, so the
 * sheet can call it on every keystroke of a promo code. The numbers it returns are
 * the same ones the charge is built from, because it runs the same function — which
 * is the only way the total on screen can be the total that is taken.
 */
app.post('/v1/checkout/quote', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const body = request.body || {};
    const cartItems = body.cartItems;
    if (!Array.isArray(cartItems) || !cartItems.length) {
      return reply.code(400).send({ success: false, error: 'A cart is required' });
    }

    const groups = groupCartBySeller(cartItems);
    const quote = await quoteCheckout({
      buyerId: auth.uid,
      groups,
      shippingKobo: Math.round(Number(body.shippingPrice || 0) * 100),
      deliveryFeePaidBy: body.deliveryFeePaidBy || null,
      code: body.code || null,
    });

    if (!quote.ok) {
      return reply.send({ success: true, eligible: false, promo: quote.promo });
    }

    // A campaign that cannot fund the order is reported as not applicable rather
    // than as an error: nothing is broken, the offer is simply unavailable.
    const chargeable = quote.budget?.ok !== false;

    return reply.send({
      success: true,
      eligible: true,
      chargeable,
      reason: chargeable ? null : quote.budget?.reason || null,
      display: quote.display,
      promo: quote.promo
        ? {
            code: quote.promo.campaign?.code || null,
            name: quote.promo.campaign?.name || null,
            message: quote.promo.message,
            requiresTicket: quote.promo.requiresTicket,
            discountKobo: quote.promo.discountKobo,
          }
        : null,
      totals: quote.totals,
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Payments & payouts ────────────────────────────────────────────────────

app.post('/v1/payments/initialize', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const body = request.body || {};
    const result = await initializeTransaction({
      uid: auth.uid,
      callerEmail: auth.email,
      email: body.email,
      amountNgn: body.amount,
      callbackUrl: body.callbackUrl,
      metadata: body.metadata,
      reference: body.reference,
      cartItems: body.cartItems,
      deliveryAddress: body.deliveryAddress,
      customerInfo: body.customerInfo,
      shippingType: body.shippingType,
      shippingPrice: body.shippingPrice,
      deliveryFeePaidBy: body.deliveryFeePaidBy,
      discountCode: body.discountCode,
      dealThreadId: body.dealThreadId || body.chatId,
      idempotencyKey: body.idempotencyKey,
    });
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/payments/verify', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const body = request.body || {};
    const result = await verifyTransaction({
      uid: auth.uid,
      isAdmin: false,
      reference: body.reference,
      expectedAmount: body.expectedAmount,
      expectedEmail: body.expectedEmail,
    });
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/payments/checkout/finalize', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await finalizeCheckout({
      uid: auth.uid,
      email: auth.email,
      body: request.body || {},
    });
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/payments/transactions/:reference', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const row = await getChargeTruth(request.params.reference);
    if (!row) return reply.code(404).send({ success: false, error: 'Unknown reference' });
    if (row.uid && row.uid !== auth.uid) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    return reply.send({ success: true, transaction: row });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * Paystack webhook.
 *
 * Registered in its own scope because the signature is an HMAC over the exact bytes
 * Paystack sent. Parsing and re-serialising the JSON would change those bytes, so
 * this route keeps the raw buffer instead.
 */
await app.register(async (instance) => {
  instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    try {
      done(null, body && body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (error) {
      done(error, undefined);
    }
  });

  instance.post('/v1/payments/webhook', async (request, reply) => {
    try {
      const result = await handlePaystackWebhook({
        rawBody: request.rawBody,
        signature: request.headers['x-paystack-signature'],
        payload: request.body,
      });
      return reply.send(result);
    } catch (error) {
      // A bad signature is a forgery and must not be retried. Anything else is our
      // own failure, so it returns 5xx for Paystack to retry.
      const code = error?.code === 'BAD_SIGNATURE' ? 401 : error?.statusCode || 500;
      return reply.code(code).send({ success: false, error: error.message });
    }
  });
});

app.get('/v1/payments/banks', async (_request, reply) => {
  try {
    const banks = await listBanks();
    return reply.send({ success: true, banks });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/payments/resolve-account', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const result = await resolveAccount(
      request.query?.accountNumber,
      request.query?.bankCode
    );
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Seller payouts ────────────────────────────────────────────────────────

app.post('/v1/seller/payout-details', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await savePayoutDetails(auth.uid, request.body || {});
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/seller/payouts', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await listPayouts({ sellerId: auth.uid, limit: request.query?.limit });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/seller/payouts', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await requestPayout({
      sellerId: auth.uid,
      amountNgn: request.body?.amount,
    });
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/seller/payouts/:payoutId/cancel', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await cancelPayout({
      sellerId: auth.uid,
      payoutId: request.params.payoutId,
    });
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/seller/payouts/:payoutId/finalize', async (request, reply) => {
  try {
    await requireAuth(request.headers.authorization);
    const result = await finalizePayout({
      payoutId: request.params.payoutId,
      otp: request.body?.otp,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/seller/earnings', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await getSellerEarnings(auth.uid);
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/admin/payouts', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const result = await listPayouts({
      sellerId: request.query?.sellerId,
      limit: request.query?.limit,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Commission rate card (§3, §12) ────────────────────────────────────────
//
// The reason this is an endpoint rather than a constant: without it, every rate
// change is a deploy. Cards are versioned by effective date so a change never
// reprices an order that was already placed.

app.get('/v1/admin/commission/rate-cards', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const [cards, current] = await Promise.all([listRateCards(), resolveRateCard()]);
    return reply.send({
      success: true,
      current: {
        id: current.id,
        name: current.name,
        effectiveFrom: current.effectiveFrom,
        tiers: current.tiers,
        isDefault: current.isDefault,
      },
      cards,
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/admin/commission/rate-cards', async (request, reply) => {
  try {
    const admin = await requireAdmin(request.headers.authorization);
    const { tiers, name, effectiveFrom, note } = request.body || {};
    const card = await createRateCard({
      tiers,
      name,
      effectiveFrom,
      note,
      createdBy: admin.uid,
    });
    return reply.send({ success: true, card });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * What an item would be charged, without placing an order.
 *
 * Exists so the seller UI can show the band before a listing is priced — the §3.1
 * cliff is invisible until it is spelled out, and it is exactly where sellers will
 * otherwise price into a worse outcome.
 */
app.get('/v1/commission/quote', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const itemsSubtotalKobo = Number(request.query?.itemsSubtotalKobo);
    const shippingKobo = Number(request.query?.shippingKobo || 0);
    if (!Number.isInteger(itemsSubtotalKobo) || itemsSubtotalKobo < 0) {
      return reply.code(400).send({
        success: false,
        error: 'itemsSubtotalKobo must be an integer number of kobo',
      });
    }

    const result = await quotePromoOrder({
      buyerId: auth.uid,
      sellerId: request.query?.sellerId || auth.uid,
      itemsSubtotalKobo,
      shippingKobo,
      code: request.query?.code || null,
      referralAmountKobo: request.query?.referralAmountKobo || null,
    });

    if (!result.quote) {
      return reply.send({ success: true, eligible: false, promo: result.promo });
    }
    return reply.send({
      success: true,
      eligible: true,
      promo: result.promo,
      budget: result.budget,
      quote: result.quote,
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Promo tickets and budget (§5.2, §5.3, §6.3) ───────────────────────────

app.get('/v1/promo/status', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    // The baseline ticket is created on first look, so the top band is reachable
    // on a first order without a separate enrolment step.
    await ensureBaselineTicket(auth.uid);
    const status = await promoStatusFor(auth.uid);
    return reply.send({ success: true, ...status });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/referrals/me', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const progress = await getReferralProgress(auth.uid);
    return reply.send({ success: true, ...progress });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/referrals/claim', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const result = await createReferral({
      referrerId: request.body?.referrerId,
      refereeId: auth.uid,
      code: request.body?.code,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Identity (§8.1, §8.2) ────────────────────────────────────────────────

/**
 * Store the buyer's verified identity for the top band.
 *
 * Raw documents are hashed on the way in and never stored — an eleven-digit BVN is
 * enumerable, so a plain digest would not be anonymisation (§14.8).
 */
app.post('/v1/identity/verify', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const { bvn, nin, bankAccount } = request.body || {};
    const result = await recordVerifiedIdentity({
      userId: auth.uid,
      bvn,
      nin,
      bankAccount,
    });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

// ─── Admin: promo, budget, review queue (§10, §12) ─────────────────────────

// ─── Promo campaigns: the toggle, the budget, the code (§5, §12) ────────────
//
// A campaign is configuration an operator owns. Everything about its shape, its
// budget and whether it is on lives in a row, so none of it needs a deploy.

app.get('/v1/admin/promo/campaigns', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const campaigns = await listCampaigns({
      includeArchived: request.query?.includeArchived === 'true',
    });
    return reply.send({ success: true, campaigns });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/admin/promo/campaigns', async (request, reply) => {
  try {
    const admin = await requireAdmin(request.headers.authorization);
    const campaign = await createCampaign(request.body || {}, { createdBy: admin.uid });
    return reply.send({ success: true, campaign });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/admin/promo/campaigns/:id', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const campaign = await getCampaign(request.params?.id);
    if (!campaign) return reply.code(404).send({ success: false, error: 'No such campaign' });
    const ledger = await listBudgetLedger({ campaignId: campaign.id, limit: 50 });
    return reply.send({ success: true, campaign, ledger });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** Change anything about a campaign, including its budget. */
app.patch('/v1/admin/promo/campaigns/:id', async (request, reply) => {
  try {
    const admin = await requireAdmin(request.headers.authorization);
    const campaign = await updateCampaign(request.params?.id, request.body || {}, {
      updatedBy: admin.uid,
    });
    return reply.send({ success: true, campaign });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** The switch an operator reaches for most. */
app.post('/v1/admin/promo/campaigns/:id/enabled', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const enabled = request.body?.enabled !== false;
    const campaign = await setCampaignEnabled(request.params?.id, enabled);
    return reply.send({ success: true, campaign });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/admin/promo/campaigns/:id/archive', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const campaign = await archiveCampaign(request.params?.id);
    return reply.send({ success: true, campaign });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/admin/promo/report', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const [report, budget] = await Promise.all([
      getPromoReport({
        since: request.query?.since ? new Date(request.query.since) : null,
        until: request.query?.until ? new Date(request.query.until) : new Date(),
      }),
      reconcileReservedBalance(),
    ]);
    return reply.send({ success: true, report, reconciliation: budget });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * The reserved-balance check on its own (§6.3).
 *
 * Worth reading alone, because it is the one number that says whether promo
 * issuance can continue at all.
 */
app.get('/v1/admin/promo/reconciliation', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const result = await reconcileReservedBalance();
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/**
 * The campaigns live right now, for the checkout modal.
 *
 * Public and unauthenticated on purpose: the modal has to show the real, current
 * offer before anyone signs in, and it must be whatever the operator configured
 * rather than a value baked into the app.
 */
app.get('/v1/promo/campaigns', async (_request, reply) => {
  try {
    const campaigns = await listLiveCampaigns();
    return reply.send({
      success: true,
      campaigns: campaigns.map((campaign) => ({
        code: campaign.code,
        name: campaign.name,
        description: campaign.description,
        discountBps: campaign.discountBps,
        capBps: campaign.capBps,
        capFloorKobo: campaign.capFloorKobo,
        capCeilingKobo: campaign.capCeilingKobo,
        capFlatKobo: campaign.capFlatKobo,
        minOrderKobo: campaign.minOrderKobo,
        firstOrderOnly: campaign.firstOrderOnly,
        requiresTicket: campaign.requiresTicket,
        ticketThresholdKobo: campaign.ticketThresholdKobo,
        endsAt: campaign.endsAt,
        // The wording the modal shows, so the app never has to infer it — and can
        // never advertise a percentage that is not what actually applies.
        display: describeCampaign(campaign),
      })),
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

/** Check a code without pricing an order — what the modal does as you type. */
app.post('/v1/promo/validate', async (request, reply) => {
  try {
    const auth = await requireAuth(request.headers.authorization);
    const code = request.body?.code;
    const itemsSubtotalKobo = Number(request.body?.itemsSubtotalKobo || 0);
    const result = await quotePromoOrder({
      buyerId: auth.uid,
      sellerId: request.body?.sellerId || auth.uid,
      itemsSubtotalKobo,
      shippingKobo: Number(request.body?.shippingKobo || 0),
      code,
    });
    if (!result.quote) {
      return reply.send({ success: true, valid: false, reason: result.promo });
    }
    return reply.send({
      success: true,
      valid: true,
      discountKobo: result.quote.discountKobo,
      buyerTotalKobo: result.quote.buyerTotalKobo,
      quote: result.quote,
      budget: result.budget,
    });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.get('/v1/admin/payout-reviews', async (request, reply) => {
  try {
    await requireAdmin(request.headers.authorization);
    const result = await listPendingPayoutReviews({ limit: request.query?.limit });
    return reply.send({ success: true, ...result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

app.post('/v1/admin/payout-reviews/:id', async (request, reply) => {
  try {
    const admin = await requireAdmin(request.headers.authorization);
    const result = await decidePayoutReview({
      reviewId: request.params?.id,
      decision: request.body?.decision,
      note: request.body?.note,
      decidedBy: admin.uid,
    });
    return reply.send({ success: true, review: result });
  } catch (error) {
    return reply.code(error.statusCode || 500).send({ success: false, error: error.message });
  }
});

const host = '0.0.0.0';
await initChatWsPubSub();
await app.listen({ port: config.port, host });
console.log(`chatcart-api listening on ${host}:${config.port}`);
