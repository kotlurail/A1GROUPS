const router = require('express').Router();
const EventEstimate = require('../models/EventEstimate');

// ── GET /api/events ───────────────────────────────────────────────────────────
// Query params: eventType, search (name/customer/mobile)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.search) {
      const re = new RegExp(req.query.search, 'i');
      filter.$or = [{ eventName: re }, { customerName: re }, { mobile: re }, { location: re }];
    }
    const events = await EventEstimate.find(filter).sort({ createdAt: -1 });
    res.json(events);
  } catch (err) { next(err); }
});

// ── GET /api/events/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const events = await EventEstimate.find().lean();

    // Grand total per event = sum of section totals (subtotal + tax - discount)
    function secTotal(d) {
      const sub = d.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
      return Math.round(sub + sub * d.taxPct / 100) - d.discount;
    }
    const grandTotal = e => e.decors.reduce((s, d) => s + secTotal(d), 0);

    const totalRevenue    = events.reduce((s, e) => s + grandTotal(e), 0);
    const totalAdvance    = events.reduce((s, e) => s + e.advance, 0);
    const balancePending  = events.reduce((s, e) => s + Math.max(0, grandTotal(e) - e.advance), 0);

    const byType = events.reduce((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {});

    res.json({ total: events.length, totalRevenue, totalAdvance, balancePending, byType });
  } catch (err) { next(err); }
});

// ── POST /api/events ──────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const event = await EventEstimate.create(req.body);
    res.status(201).json(event);
  } catch (err) { next(err); }
});

// ── PUT /api/events/:id ───────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const event = await EventEstimate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) { next(err); }
});

// ── DELETE /api/events/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const event = await EventEstimate.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
