const router = require('express').Router();
const InventoryItem = require('../models/InventoryItem');
const RentalEntry   = require('../models/RentalEntry');

// ── GET /api/inventory ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.venue)    filter.venue    = req.query.venue;
    if (req.query.category) filter.category = req.query.category;
    const items = await InventoryItem.find(filter).sort({ category: 1, name: 1 });
    res.json(items);
  } catch (err) { next(err); }
});

// ── GET /api/inventory/availability ──────────────────────────────────────────
// Returns each item with its currently-out qty and available qty
router.get('/availability', async (req, res, next) => {
  try {
    const [items, rentals] = await Promise.all([
      InventoryItem.find().lean(),
      RentalEntry.find().lean(),
    ]);

    // Build a map: itemId -> qty currently out (given - returned)
    const inUseMap = {};
    for (const rental of rentals) {
      for (const ri of rental.items) {
        const out = Math.max(0, ri.qtyGiven - ri.qtyReturned);
        inUseMap[ri.itemId.toString()] = (inUseMap[ri.itemId.toString()] || 0) + out;
      }
    }

    const result = items.map(item => ({
      ...item,
      inUse:     inUseMap[item._id.toString()] || 0,
      available: Math.max(0, item.totalQty - (inUseMap[item._id.toString()] || 0)),
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/inventory ───────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const item = await InventoryItem.create(req.body);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// ── PUT /api/inventory/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// ── DELETE /api/inventory/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const item = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
