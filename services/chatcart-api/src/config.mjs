import dotenv from 'dotenv';

// Local services/chatcart-api/.env must win over machine-wide GOOGLE_APPLICATION_CREDENTIALS.
dotenv.config({ override: true });

export const config = {
  port: Number(process.env.PORT || 8080),
  corsOrigins: process.env.CORS_ORIGINS === '*' ? true : (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || '',
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'ikm-marketplace',
  firebaseCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  feedCacheTtlSec: Number(process.env.FEED_CACHE_TTL_SEC || 600),
  feedPageSize: Number(process.env.FEED_PAGE_SIZE || 12),
  feedSessionSize: Number(process.env.FEED_SESSION_SIZE || 100),
  feedSessionTtlSec: Number(process.env.FEED_SESSION_TTL_SEC || 7200),
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2Bucket: process.env.R2_BUCKET || 'chatcart-media-prod',
  mediaCdnUrl: (process.env.MEDIA_CDN_URL || '').replace(/\/$/, ''),
  mediaPresignTtlSec: Number(process.env.MEDIA_PRESIGN_TTL_SEC || 3600),
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  chatInternalSecret: process.env.CHAT_INTERNAL_SECRET || '',
};

export const FEED_PAGE_SIZE = 12;
export const FEED_SESSION_SIZE = 100;
/** @deprecated use FEED_SESSION_SIZE — kept for internal ranking slice */
export const FEED_TOTAL = FEED_SESSION_SIZE;
export const BUCKET_A_SIZE = 50;
export const BUCKET_B_SIZE = 30;
export const BUCKET_C_SIZE = 20;
export const COLD_START_MAX_VIEWS = 100;
export const COLD_START_MAX_AGE_HOURS = 6;
export const TASTE_INTERACTION_LIMIT = 10;

export function isR2Configured() {
  return Boolean(
    config.r2AccountId &&
      config.r2AccessKeyId &&
      config.r2SecretAccessKey &&
      config.r2Bucket &&
      config.mediaCdnUrl
  );
}
