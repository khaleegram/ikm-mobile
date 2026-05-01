/**
 * Market follow counters (`users.*.followerCount` / `followingCount`) are updated by the
 * client in the same batched write as `marketFollows/{follower}_{followed}`, enforced by
 * Firestore security rules. Cloud Function triggers here would double-count.
 *
 * Intentionally empty module.
 */
export {};
