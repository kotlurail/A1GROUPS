const router = require('express').Router();
const DecorMasterItem = require('../models/DecorMasterItem');

const DEFAULT_ITEMS = [
  'White Daisy','Pink Daisy','Blue Daisy','Export Dutch Jumulia','Export Dutch Rockstar',
  'Grass','Kamini','Palm Leaves','Long Leaves','Song of India',
  'Foam Boxes','Jerbera','Calemora Buttons','Zipsy',
  'Iron Cake Mesh','Sanna Theega','Lavu Theega',
  '1 Feet Boxes','2 Feet Boxes','3 Feet Boxes','4 Feet Boxes','5 Feet Boxes',
  '6 Feet Boxes','7 Feet Boxes','8 Feet Boxes','10 Feet Boxes','12 Feet Boxes',
  '8h x 10w Frames','8h x 4w Frames','10h x 10w Frames','3h x 2w welcome Board',
  '1 feet Mokka','2 feet Mokka','3 feet Mokka','4 feet Mokka','5 feet Mokka',
  '6 Feet Mokka','7 Feet Mokka','8 feet Mokka',
  'Fresh Flowers','Artificial Flowers','Balloons','Candles',
  'Ribbon','Fabric / Cloth','LED Strip Lights','Spotlights','Warm Lamps',
  'Thermocol','Foam Sheets','Wire Coil','WhiteTape','Scissors',
  'Chandeliers(Round)','Transport','Labour(Gents)','Labour(Ladies)',
  'Brass items','Haldi Tubs','Haldi Set(5 Gangalams & 1 Chembu)',
  'Sofa','Cake Table','Cake Drums Set(3)',
  '7h x 4w Frame Birthday','6h x 4w Birthday','7h x 4w Jali Frame Birthday',
  '4 x 4 Stage','3 x 4 stage','3 x 3 Stage',
  'Chairs','Steel Tables','Parrot Rings',
  'Show Lights','Show Lights & Frames','6 x 6 Ring','5 x 5 Ring','Other',
];

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  const count = await DecorMasterItem.countDocuments();
  if (count === 0) {
    await DecorMasterItem.insertMany(DEFAULT_ITEMS.map(name => ({ name })));
  }
  seeded = true;
}

// GET /api/decor-items  — return all items sorted by name
router.get('/', async (req, res, next) => {
  try {
    await ensureSeeded();
    const items = await DecorMasterItem.find().sort({ name: 1 }).lean();
    res.json(items);
  } catch (err) { next(err); }
});

// POST /api/decor-items  — add a new item
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const item = await DecorMasterItem.create({ name });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Item already exists' });
    next(err);
  }
});

// DELETE /api/decor-items/:id  — remove an item
router.delete('/:id', async (req, res, next) => {
  try {
    await DecorMasterItem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
