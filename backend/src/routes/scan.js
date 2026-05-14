import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getRedisClient } from '../services/redis.js';
import { extractGmailSubscriptions } from '../services/gmailExtractor.js';
import { classifySubscriptions } from '../services/classifier.js';

const router = express.Router();
const activeScans = new Map();

router.post('/start', requireAuth, async (req, res) => {
  const user = req.session.user;
  const scanId = `scan_${user.id}_${Date.now()}`;

  if (activeScans.has(user.id)) {
    const existing = activeScans.get(user.id);
    return res.json({ jobId: existing.scanId, status: 'active' });
  }

  activeScans.set(user.id, { scanId, progress: 0, status: 'running' });
  res.json({ jobId: scanId, status: 'queued' });

  runScan(user, scanId).catch(err => {
    console.error('[scan] Error:', err);
    if (activeScans.has(user.id)) {
      activeScans.set(user.id, { scanId, progress: 0, status: 'failed', error: err.message });
    }
  });
});

router.get('/status/:jobId', requireAuth, async (req, res) => {
  const user = req.session.user;
  const scan = activeScans.get(user.id);

  if (!scan || scan.scanId !== req.params.jobId) {
    const redis = getRedisClient();
    const cached = await redis.get(`subscriptions:${user.id}`);
    if (cached) {
      return res.json({ jobId: req.params.jobId, status: 'completed', progress: 100 });
    }
    return res.status(404).json({ error: 'Scan not found' });
  }

  res.json({
    jobId: scan.scanId,
    status: scan.status,
    progress: scan.progress,
    error: scan.error || null,
  });
});

async function runScan(user, scanId) {
  const redis = getRedisClient();

  const updateProgress = (progress) => {
    if (activeScans.has(user.id)) {
      activeScans.set(user.id, { scanId, progress, status: 'running' });
    }
  };

  try {
    updateProgress(5);
    console.log(`[scan] Starting for user ${user.id}`);

    const rawSenders = await extractGmailSubscriptions(
      user.accessToken,
      user.refreshToken,
      user.tokenExpiry,
      updateProgress
    );

    console.log(`[scan] Found ${rawSenders.length} unique senders`);
    updateProgress(75);

    const subscriptions = await classifySubscriptions(rawSenders);
    console.log(`[scan] Classified ${subscriptions.length} subscriptions`);
    updateProgress(95);

    // Sort priority:
    //   1. Paid subs with billing emails (receipts/invoices) — most important, real money
    //   2. Other paid subs
    //   3. One-time payments (paid, occasional/yearly frequency)
    //   4. Recurring (monthly/weekly/daily)
    //   5. Free subscriptions
    const priorityScore = (s) => {
      if (s.hasBillingEmails && s.isPaid) return 100 + s.billingEmailCount; // top — confirmed paid
      if (s.isPaid && s.frequency === 'occasional') return 80;              // one-time payments
      if (s.isPaid && s.frequency === 'monthly') return 70;                 // monthly paid
      if (s.isPaid) return 60;                                              // any other paid
      return 0;                                                             // free
    };
    subscriptions.sort((a, b) => {
      const diff = priorityScore(b) - priorityScore(a);
      if (diff !== 0) return diff;
      return b.emailCount - a.emailCount; // tiebreak by email count
    });

    const key = `subscriptions:${user.id}`;
    await redis.set(key, JSON.stringify(subscriptions), 'EX', 60 * 60 * 24 * 30);

    activeScans.set(user.id, { scanId, progress: 100, status: 'completed' });
    console.log(`[scan] Done. ${subscriptions.length} subscriptions saved.`);

    setTimeout(() => activeScans.delete(user.id), 60 * 1000);

  } catch (err) {
    console.error(`[scan] Failed:`, err);
    activeScans.set(user.id, { scanId, progress: 0, status: 'failed', error: err.message });
    setTimeout(() => activeScans.delete(user.id), 60 * 1000);
    throw err;
  }
}

export default router;
