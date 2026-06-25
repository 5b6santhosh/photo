'use strict';

// ─────────────────────────────────────────────
//  gimbi.router.js  (Express router)
//  v3.1.0 — try/catch on all routes
// ─────────────────────────────────────────────

const express = require('express');
const multer = require('multer');
const router = express.Router();
const gimbiService = require('../services/gimbi.service');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({ dest: 'uploads/' });

// GET /api/gimbi/status
router.get('/status', (_req, res) => {
  try {
    res.json(gimbiService.getStatus());
  } catch (err) {
    console.error('/status error', err);
    res.status(500).json({ expression: 'concerned', message: 'Status unavailable.', tip: null });
  }
});

// GET /api/gimbi/history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.query;
    const userId = req.user?.id;
    const historyData = await gimbiService.getSessionHistory(sessionId, userId ? String(userId) : null);
    res.json(historyData);
  } catch (err) {
    console.error('/history error', err);
    res.status(500).json({ error: 'Failed to retrieve chat history.' });
  }
});

// POST /api/gimbi/chat
router.post('/chat', upload.single('image'), async (req, res) => {
  try {
    const { userId, message, sessionId, userLevel } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    const result = await gimbiService.chat({
      userId,
      message,
      sessionId,
      imageFile: req.file,
      userLevel
    });
    res.json(result);
  } catch (err) {
    console.error('/chat error', err);
    res.status(500).json({ expression: 'concerned', message: "Oops! My circuits got confused — try again? 🤖", tip: null });
  }
});

// POST /api/gimbi/analyze
router.post('/analyze', (req, res) => {
  try {
    const result = gimbiService.analyze(req.body);
    res.json(result);
  } catch (err) {
    console.error('/analyze error', err);
    res.status(500).json({ expression: 'concerned', message: "Couldn't analyze that shot.", tip: null });
  }
});

// GET /api/gimbi/challenge
router.get('/challenge', (_req, res) => {
  try {
    res.json(gimbiService.getChallenge());
  } catch (err) {
    console.error('/challenge error', err);
    res.status(500).json({ expression: 'concerned', message: "Couldn't load today's challenge.", tip: null });
  }
});

// GET /api/gimbi/progress/:userId
router.get('/progress/:userId', (req, res) => {
  try {
    res.json(gimbiService.getProgress(req.params.userId));
  } catch (err) {
    console.error('/progress error', err);
    res.status(500).json({ expression: 'concerned', message: "Couldn't load your progress.", tip: null });
  }
});

// POST /api/gimbi/nudge
router.post('/nudge', (req, res) => {
  try {
    res.json(gimbiService.getNudge(req.body));
  } catch (err) {
    console.error('/nudge error', err);
    res.status(500).json({ expression: 'concerned', message: "Nudge failed.", tip: null });
  }
});

// DELETE /api/gimbi/user/:userId
router.delete('/user/:userId', (req, res) => {
  try {
    gimbiService.clearUser(req.params.userId);
    res.json({ success: true, message: 'User data cleared.' });
  } catch (err) {
    console.error('/user delete error', err);
    res.status(500).json({ success: false, message: 'Could not clear user.' });
  }
});

module.exports = router;