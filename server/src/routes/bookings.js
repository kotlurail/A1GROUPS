const router  = require('express').Router();
const Booking = require('../models/Booking');

// GET /api/bookings?venue=&status=&date=YYYY-MM-DD&month=YYYY-MM
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.venue)  filter.venue  = req.query.venue;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.date)   filter.date   = req.query.date;
    if (req.query.month)  filter.date   = { $regex: '^' + req.query.month };
    const bookings = await Booking.find(filter).sort({ date: 1, slot: 1 });
    res.json(bookings);
  } catch (err) { next(err); }
});

// POST /api/bookings
router.post('/', async (req, res, next) => {
  try {
    const booking = await Booking.create(req.body);
    res.status(201).json(booking);
  } catch (err) { next(err); }
});

// PUT /api/bookings/:id
router.put('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(booking);
  } catch (err) { next(err); }
});

// DELETE /api/bookings/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
