const router          = require('express').Router();
const jwt             = require('jsonwebtoken');
const crypto          = require('crypto');
const requireAuth     = require('../middleware/auth');
const TokenBlacklist  = require('../models/TokenBlacklist');

// POST /api/auth/login  { pin }
router.post('/login', (req, res) => {
  const { pin } = req.body;
  const correctPin = String(process.env.APP_PIN ?? '');

  const a = Buffer.from(String(pin ?? ''));
  const b = Buffer.from(correctPin);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) return res.status(401).json({ error: 'Incorrect PIN' });

  // Token valid for 25 hours (slightly beyond the 24h client-side session)
  const token = jwt.sign({ app: 'a1groups' }, process.env.JWT_SECRET, { expiresIn: '25h' });
  res.json({ token });
});

// POST /api/auth/logout  (requires valid token)
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization.slice(7);
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 25 * 3600 * 1000);

    await TokenBlacklist.create({ token, expiresAt });
    res.json({ ok: true });
  } catch (err) {
    // If already blacklisted (duplicate key), still treat as success
    if (err.code === 11000) return res.json({ ok: true });
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
