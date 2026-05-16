const router   = require('express').Router();
const Employee = require('../models/Employee');

// ── GET /api/employees ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) { next(err); }
});

// ── POST /api/employees ───────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const emp = await Employee.create(req.body);
    res.status(201).json(emp);
  } catch (err) { next(err); }
});

// ── PUT /api/employees/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const emp = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(emp);
  } catch (err) { next(err); }
});

// ── PATCH /api/employees/:id/attendance ──────────────────────────────────────
// Body: { date: 'YYYY-MM-DD', status: 'present'|'absent'|'half'|'holiday'|null }
// Passing null/undefined status removes that date's record.
router.patch('/:id/attendance', async (req, res, next) => {
  try {
    const { date, status } = req.body;
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const idx = emp.attendance.findIndex(a => a.date === date);
    if (!status) {
      if (idx !== -1) emp.attendance.splice(idx, 1);
    } else if (idx !== -1) {
      emp.attendance[idx].status = status;
    } else {
      emp.attendance.push({ date, status });
    }
    await emp.save();
    res.json(emp);
  } catch (err) { next(err); }
});

// ── POST /api/employees/:id/cash ──────────────────────────────────────────────
router.post('/:id/cash', async (req, res, next) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    emp.cashEntries.push(req.body);
    await emp.save();
    res.json(emp);
  } catch (err) { next(err); }
});

// ── DELETE /api/employees/:id/cash/:cashId ────────────────────────────────────
router.delete('/:id/cash/:cashId', async (req, res, next) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const entry = emp.cashEntries.id(req.params.cashId);
    if (!entry) return res.status(404).json({ error: 'Cash entry not found' });
    entry.deleteOne();
    await emp.save();
    res.json(emp);
  } catch (err) { next(err); }
});

// ── DELETE /api/employees/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const emp = await Employee.findByIdAndDelete(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
