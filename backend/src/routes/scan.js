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

    // Sort: paid first, then trials by soonest expiring
    subscriptions.sort((a, b) => {
      if (a.isPaid && !b.isPaid) return -1;
      if (!a.isPaid && b.isPaid) return 1;
      // Within trials: soonest expiring first
      if (a.isTrial && b.isTrial) {
        return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
      }
      // Within paid: by service name alphabetical
      return (a.serviceName || '').localeCompare(b.serviceName || '');
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
