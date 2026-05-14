import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getRedisClient } from '../services/redis.js';

const router = express.Router();

// GET /subscriptions - get all subscriptions for user
router.get('/', requireAuth, async (req, res) => {
  const redis = getRedisClient();
  const key = `subscriptions:${req.session.user.id}`;

  try {
    const data = await redis.get(key);
    if (!data) return res.json({ subscriptions: [], scanned: false });
    res.json({ subscriptions: JSON.parse(data), scanned: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// POST /subscriptions/:id/unsubscribe - trigger unsubscribe action
router.post('/:id/unsubscribe', requireAuth, async (req, res) => {
  const redis = getRedisClient();
  const key = `subscriptions:${req.session.user.id}`;

  try {
    const data = await redis.get(key);
    if (!data) return res.status(404).json({ error: 'No subscriptions found' });

    const subscriptions = JSON.parse(data);
    const sub = subscriptions.find(s => s.id === req.params.id);

    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    // Mark as unsubscribed in our store
    sub.status = 'unsubscribed';
    sub.unsubscribedAt = new Date().toISOString();
    await redis.set(key, JSON.stringify(subscriptions), 'EX', 60 * 60 * 24 * 30);

    // Return the unsubscribe URL/method for frontend to action
    res.json({
      success: true,
      method: sub.unsubscribeMethod, // 'link' | 'mailto' | 'manual'
      url: sub.unsubscribeUrl,
      email: sub.unsubscribeEmail,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// DELETE /subscriptions/:id - dismiss/hide a subscription card
router.delete('/:id', requireAuth, async (req, res) => {
  const redis = getRedisClient();
  const key = `subscriptions:${req.session.user.id}`;

  try {
    const data = await redis.get(key);
    if (!data) return res.status(404).json({ error: 'Not found' });

    const subscriptions = JSON.parse(data).filter(s => s.id !== req.params.id);
    await redis.set(key, JSON.stringify(subscriptions), 'EX', 60 * 60 * 24 * 30);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
