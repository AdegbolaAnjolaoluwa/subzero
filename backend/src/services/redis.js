import Redis from 'ioredis';

let client = null;

export function getRedisClient() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return client;
}

export function createRedisConnection() {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}
