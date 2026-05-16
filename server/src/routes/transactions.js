const router = require('express').Router();
const Transaction = require('../models/Transaction');

// ── GET /api/transactions ─────────────────────────────────────────────────────
// Query params: type, venue, status, from (YYYY-MM-DD), to (YYYY-MM-DD)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type)   filter.type   = req.query.type;
    if (req.query.venue)  filter.venue  = req.query.venue;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = req.query.from;
      if (req.query.to)   filter.date.$lte = req.query.to;
    }
    const txns = await Transaction.find(filter).sort({ date: -1 });
    res.json(txns);
  } catch (err) { next(err); }
});

// ── GET /api/transactions/stats ───────────────────────────────────────────────
// Returns totals grouped by type, per-venue breakdown, and monthly trend
router.get('/stats', async (req, res, next) => {
  try {
    const [summary, byVenue, monthly] = await Promise.all([
      Transaction.aggregate([
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $group: { _id: { venue: '$venue', type: '$type' }, total: { $sum: '$amount' } } },
        { $sort: { '_id.venue': 1 } },
      ]),
      Transaction.aggregate([
        { $group: {
            _id:   { month: { $substr: ['$date', 0, 7] }, type: '$type' },
            total: { $sum: '$amount' },
        }},
        { $sort: { '_id.month': 1 } },
      ]),
    ]);
    res.json({ summary, byVenue, monthly });
  } catch (err) { next(err); }
});

// ── POST /api/transactions ────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const txn = await Transaction.create(req.body);
    res.status(201).json(txn);
  } catch (err) { next(err); }
});

// ── PUT /api/transactions/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const txn = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    res.json(txn);
  } catch (err) { next(err); }
});

// ── DELETE /api/transactions/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const txn = await Transaction.findByIdAndDelete(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
