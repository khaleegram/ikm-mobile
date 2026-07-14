export const ACTION_WEIGHTS = {
  full_completion: 10,
  loop: 8,
  dwell: 2,
  chat: 15,
  like: 2,
  favorite: 2,
  immediate_skip: -12,
};

const IMMEDIATE_SKIP_THRESHOLD_SEC = 2;
const COMPLETION_THRESHOLD = 0.95;
const IMAGE_COMPLETION_SEC = 5;
const IMAGE_VIEW_TARGET_SEC = 8;
const DWELL_BLOCK_SEC = 4;
const MAX_DWELL_BLOCKS = 5;

export function computeDecayedScore(totalPoints, createdAt) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ageHours = Math.max(0, (Date.now() - created.getTime()) / 3_600_000);
  const denominator = Math.pow(ageHours + 2, 1.5);
  if (denominator <= 0) return totalPoints;
  return totalPoints / denominator;
}

export function normalizeHashtags(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    )
  );
}

export function pointsForActions(actions) {
  let total = 0;
  for (const [action, count] of Object.entries(actions)) {
    const weight = ACTION_WEIGHTS[action];
    const n = Number(count || 0);
    if (!weight || !Number.isFinite(n) || n === 0) continue;
    total += weight * n;
  }
  return total;
}

export function deriveWatchActions(payload) {
  const watchTimeSec = Math.max(0, Number(payload.watchTimeSec || 0));
  const videoDurationSec = Math.max(0, Number(payload.videoDurationSec || 0));
  const mediaType = String(payload.mediaType || 'video').trim();
  const isImage = mediaType === 'image_gallery';
  const actions = {};

  if (watchTimeSec > 0 && watchTimeSec < IMMEDIATE_SKIP_THRESHOLD_SEC) {
    actions.immediate_skip = 1;
    return actions;
  }

  if (isImage) {
    const targetSec = Math.max(IMAGE_VIEW_TARGET_SEC, videoDurationSec || IMAGE_VIEW_TARGET_SEC);
    if (watchTimeSec >= IMAGE_COMPLETION_SEC || watchTimeSec >= targetSec * COMPLETION_THRESHOLD) {
      actions.full_completion = 1;
    }
  } else if (videoDurationSec > 0) {
    const requiredWatchSec = Math.max(8, videoDurationSec * COMPLETION_THRESHOLD);
    if (watchTimeSec >= requiredWatchSec) {
      actions.full_completion = 1;
    }
  } else if (watchTimeSec >= 12) {
    actions.full_completion = 1;
  }

  if (watchTimeSec >= DWELL_BLOCK_SEC) {
    const dwellBlocks = Math.min(MAX_DWELL_BLOCKS, Math.floor(watchTimeSec / DWELL_BLOCK_SEC));
    if (dwellBlocks > 0) actions.dwell = dwellBlocks;
  }

  return actions;
}
