import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { createRedisConnection, getRedisClient } from '../services/redis.js';
import { extractGmailSubscriptions } from '../services/gmailExtractor.js';
import { classifySubscriptions } from '../services/classifier.js';

dotenv.config();

const worker = new Worker('email-scan', async (job) => {
  const { userId, accessToken, refreshToken, tokenExpiry } = job.data;
  const redis = getRedisClient();

  try {
    await job.updateProgress(5);
    console.log(`[scan] Starting scan for user ${userId}`);

    // Step 1: Extract emails from Gmail
    const rawSenders = await extractGmailSubscriptions(
      accessToken,
      refreshToken,
      tokenExpiry,
      (progress) => job.updateProgress(progress)
    );

    console.log(`[scan] Extracted ${rawSenders.length} unique senders`);
    await job.updateProgress(75);

    // Step 2: Classify with Gemini
    const subscriptions = await classifySubscriptions(rawSenders);
    console.log(`[scan] Classified ${subscriptions.length} subscriptions`);
    await job.updateProgress(95);

    // Step 3: Sort by email count (most active first)
    subscriptions.sort((a, b) => b.emailCount - a.emailCount);

    // Step 4: Save to Redis (30 day cache)
    const key = `subscriptions:${userId}`;
    await redis.set(key, JSON.stringify(subscriptions), 'EX', 60 * 60 * 24 * 30);

    await job.updateProgress(100);
    console.log(`[scan] Done. Saved ${subscriptions.length} subscriptions for user ${userId}`);

    return { count: subscriptions.length };
  } catch (err) {
    console.error(`[scan] Failed for user ${userId}:`, err);
    throw err;
  }
}, {
  connection: createRedisConnection(),
  concurrency: 3,
});

worker.on('completed', job => console.log(`[worker] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[worker] Job ${job?.id} failed:`, err.message));

console.log('[worker] Scan worker started and listening...');
