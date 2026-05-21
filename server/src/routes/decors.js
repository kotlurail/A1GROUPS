const router  = require('express').Router();
const Decor   = require('../models/Decor');
const Booking = require('../models/Booking');

function calcDecorCost(decor) {
  return decor.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
}

// GET /api/decors?eventType=&status=&search=&bookingId=
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.status)    filter.paymentStatus = req.query.status;
    if (req.query.bookingId) filter.bookingId = req.query.bookingId;
    if (req.query.search) {
      const re = new RegExp(req.query.search, 'i');
      filter.$or = [{ eventName: re }, { customerName: re }, { mobile: re }];
    }
    const decors = await Decor.find(filter).sort({ createdAt: -1 });
    res.json(decors);
  } catch (err) { next(err); }
});

// POST /api/decors
router.post('/', async (req, res, next) => {
  try {
    const decor = await Decor.create(req.body);
    // Sync decorCost to linked booking
    if (decor.bookingId) {
      const cost = calcDecorCost(decor);
      await Booking.findByIdAndUpdate(decor.bookingId, { decorCost: cost });
    }
    res.status(201).json(decor);
  } catch (err) { next(err); }
});

// PUT /api/decors/:id
router.put('/:id', async (req, res, next) => {
  try {
    const prev  = await Decor.findById(req.params.id).lean();
    const decor = await Decor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!decor) return res.status(404).json({ error: 'Not found' });

    const prevBid = prev?.bookingId ? String(prev.bookingId) : null;
    const newBid  = decor.bookingId ? String(decor.bookingId) : null;

    // If booking link was removed or changed, clear decorCost on old booking
    if (prevBid && prevBid !== newBid) {
      await Booking.findByIdAndUpdate(prevBid, { decorCost: null });
    }
    // Set/update decorCost on new linked booking
    if (newBid) {
      const cost = calcDecorCost(decor);
      await Booking.findByIdAndUpdate(newBid, { decorCost: cost });
    }

    res.json(decor);
  } catch (err) { next(err); }
});

// DELETE /api/decors/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const decor = await Decor.findByIdAndDelete(req.params.id);
    if (!decor) return res.status(404).json({ error: 'Not found' });
    // Clear decorCost from linked booking if any
    if (decor.bookingId) {
      await Booking.findByIdAndUpdate(decor.bookingId, { decorCost: null });
    }
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
