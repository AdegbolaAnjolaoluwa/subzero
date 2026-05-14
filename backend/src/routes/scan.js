import express from 'express';
import { Queue } from 'bullmq';
import { createRedisConnection } from '../services/redis.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const scanQueue = new Queue('email-scan', {
  connection: createRedisConnection(),
});

// POST /scan/start - kick off a background scan
router.post('/start', requireAuth, async (req, res) => {
  const user = req.session.user;

  try {
    const job = await scanQueue.add('scan', {
      userId: user.id,
      userEmail: user.email,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      tokenExpiry: user.tokenExpiry,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    console.error('Failed to queue scan:', err);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

// GET /scan/status/:jobId - poll job status
router.get('/status/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await scanQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const state = await job.getState();
    const progress = job.progress;

    res.json({
      jobId: job.id,
      status: state,
      progress: progress || 0,
      result: state === 'completed' ? job.returnvalue : null,
      error: state === 'failed' ? job.failedReason : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

export default router;
