const jwt            = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — please log in' });
  }

  const token = header.slice(7);

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }

  try {
    const blacklisted = await TokenBlacklist.exists({ token });
    if (blacklisted) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }
  } catch {
    // If DB check fails, allow request through (availability over strict security)
  }

  next();
};
