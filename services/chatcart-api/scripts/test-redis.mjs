import 'dotenv/config';
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required in .env');
  process.exit(1);
}

const redis = new Redis({ url, token });
const key = 'chatcart:ping';
await redis.set(key, 'ok', { ex: 60 });
const val = await redis.get(key);
console.log('Upstash Redis OK:', val === 'ok' ? 'connected' : `unexpected: ${val}`);
