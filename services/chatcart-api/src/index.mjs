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
  listTrendingHashtags,
  searchPosts,
} from './posts.mjs';
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
} from './social-graph.mjs';
import { getUser, updateUser, registerFcmToken } from './users.mjs';
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
} from './chat-ws.mjs';
import { touchPresence } from './chat-presence.mjs';

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
    await requireAuth(request.headers.authorization);
    const posterId = String(request.query?.posterId || '').trim();
    if (!posterId) {
      return reply.code(400).send({ success: false, error: 'posterId is required' });
    }
    const limit = Math.min(60, Math.max(1, Number(request.query?.limit || 40)));
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
    await requireAuth(request.headers.authorization);
    const raw = String(request.query?.ids || '');
    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 50);
    const posts = await getPostsBatch(ids);
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
    await requireAuth(request.headers.authorization);
    const post = await getPostById(request.params.postId);
    if (!post) return reply.code(404).send({ success: false, error: 'Post not found' });
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
    const ids = await listFollowingIds(auth.uid);
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

const host = '0.0.0.0';
await app.listen({ port: config.port, host });
console.log(`chatcart-api listening on ${host}:${config.port}`);
