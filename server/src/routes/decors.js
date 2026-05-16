const router = require('express').Router();
const Decor  = require('../models/Decor');

// GET /api/decors?eventType=&status=&search=
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.status)    filter.paymentStatus = req.query.status;
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
    res.status(201).json(decor);
  } catch (err) { next(err); }
});

// PUT /api/decors/:id
router.put('/:id', async (req, res, next) => {
  try {
    const decor = await Decor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!decor) return res.status(404).json({ error: 'Not found' });
    res.json(decor);
  } catch (err) { next(err); }
});

// DELETE /api/decors/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const decor = await Decor.findByIdAndDelete(req.params.id);
    if (!decor) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
