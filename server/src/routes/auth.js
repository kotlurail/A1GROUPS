const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

// POST /api/auth/login  { pin }
router.post('/login', (req, res) => {
  const { pin } = req.body;
  const correctPin = String(process.env.APP_PIN ?? '');

  // Constant-time comparison — prevents timing attacks
  const a = Buffer.from(String(pin ?? ''));
  const b = Buffer.from(correctPin);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) return res.status(401).json({ error: 'Incorrect PIN' });

  const token = jwt.sign({ app: 'a1groups' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

module.exports = router;
