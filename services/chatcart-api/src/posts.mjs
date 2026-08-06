import { deletePost as deletePostPg } from './posts-repo.mjs';

/** @deprecated Firestore delete path — market posts now live in Postgres. */
export async function deleteMarketPost(uid, postId, options = {}) {
  return deletePostPg(uid, postId, { isAdmin: Boolean(options.isAdmin) });
}

export {
  createPost,
  updatePost,
  deletePost,
  getPostById,
  getPostsBatch,
  hydratePosts,
  listPostsBySound,
  listTrendingHashtags,
  searchPosts,
} from './posts-repo.mjs';
