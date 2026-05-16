const router = require('express').Router();
const RentalEntry = require('../models/RentalEntry');

// ── GET /api/rentals ──────────────────────────────────────────────────────────
// Query params: returnStatus (pending|partial|returned), venue, from, to
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.returnStatus) filter['items.returnStatus'] = req.query.returnStatus;
    if (req.query.venue)        filter.venueLocation         = req.query.venue;
    if (req.query.from || req.query.to) {
      filter.eventDate = {};
      if (req.query.from) filter.eventDate.$gte = req.query.from;
      if (req.query.to)   filter.eventDate.$lte = req.query.to;
    }
    const rentals = await RentalEntry.find(filter).sort({ createdAt: -1 });
    res.json(rentals);
  } catch (err) { next(err); }
});

// ── POST /api/rentals ─────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const rental = await RentalEntry.create(req.body);
    res.status(201).json(rental);
  } catch (err) { next(err); }
});

// ── PUT /api/rentals/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const rental = await RentalEntry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    res.json(rental);
  } catch (err) { next(err); }
});

// ── PATCH /api/rentals/:id/items/:itemId/return ───────────────────────────────
// Update return details for a single item inside a rental without touching the rest
router.patch('/:id/items/:itemId/return', async (req, res, next) => {
  try {
    const { returnStatus, qtyReturned, returnCond, damageNotes, penalty, returnDate } = req.body;
    const rental = await RentalEntry.findById(req.params.id);
    if (!rental) return res.status(404).json({ error: 'Rental not found' });

    const item = rental.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found in rental' });

    if (returnStatus !== undefined) item.returnStatus = returnStatus;
    if (qtyReturned  !== undefined) item.qtyReturned  = qtyReturned;
    if (returnCond   !== undefined) item.returnCond   = returnCond;
    if (damageNotes  !== undefined) item.damageNotes  = damageNotes;
    if (penalty      !== undefined) item.penalty      = penalty;
    if (returnDate   !== undefined) item.returnDate   = returnDate;

    await rental.save();
    res.json(rental);
  } catch (err) { next(err); }
});

// ── DELETE /api/rentals/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const rental = await RentalEntry.findByIdAndDelete(req.params.id);
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
