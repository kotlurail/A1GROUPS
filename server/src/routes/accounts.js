const router      = require('express').Router();
const Booking     = require('../models/Booking');
const Decor       = require('../models/Decor');
const Employee    = require('../models/Employee');
const RentalEntry = require('../models/RentalEntry');
const Transaction = require('../models/Transaction');

// GET /api/accounts/feed?from=YYYY-MM-DD&to=YYYY-MM-DD&type=income|expense&source=Bookings,Decors,...
router.get('/feed', async (req, res, next) => {
  try {
    const { from, to, type } = req.query;
    const sources = req.query.source
      ? req.query.source.split(',')
      : ['Bookings', 'Decors', 'Employees', 'Rentals', 'Manual'];

    const inDateRange = (d) => (!from || d >= from) && (!to || d <= to);
    const results = [];

    // ── Bookings ──────────────────────────────────────────────────────────────
    if (sources.includes('Bookings')) {
      const bookings = await Booking.find({});
      for (const b of bookings) {
        // Each payment logged = income
        if (!type || type === 'income') {
          for (const p of b.payments) {
            if (!inDateRange(p.date)) continue;
            results.push({
              id:            `booking-pay-${b._id}-${p._id}`,
              source:        'Bookings',
              type:          'income',
              amount:        p.amount,
              category:      'Hall Booking',
              reference:     b.client,
              venue:         b.venue,
              date:          p.date,
              eventDate:     b.date,
              paymentMethod: p.mode,
              status:        'completed',
              note:          p.note || b.eventName,
            });
          }
        }
        // Expenses logged against the booking
        if (!type || type === 'expense') {
          for (const e of b.expenses) {
            if (!inDateRange(b.date)) continue;
            results.push({
              id:            `booking-exp-${b._id}-${e._id}`,
              source:        'Bookings',
              type:          'expense',
              amount:        e.amount,
              category:      e.title,
              reference:     b.client,
              venue:         b.venue,
              date:          b.date,
              eventDate:     b.date,
              paymentMethod: 'Cash',
              status:        'completed',
              note:          b.eventName,
            });
          }
        }
      }
    }

    // ── Decors ────────────────────────────────────────────────────────────────
    if (sources.includes('Decors')) {
      const decors = await Decor.find();
      for (const d of decors) {
        const baseDate = d.createdDate || (d.createdAt ? d.createdAt.toISOString().slice(0, 10) : '');
        const venue    = d.location || 'A1 Events & Decors';
        const status   = d.paymentStatus === 'completed' ? 'completed' : 'pending';

        const decorEventDate = d.eventDate || baseDate;

        if (!type || type === 'income') {
          if (d.advanceAmount > 0 && inDateRange(baseDate)) {
            results.push({
              id:            `decor-adv-${d._id}`,
              source:        'Decors',
              type:          'income',
              amount:        d.advanceAmount,
              category:      'Decoration Advance',
              reference:     d.customerName,
              venue,
              date:          baseDate,
              eventDate:     decorEventDate,
              paymentMethod: 'Cash',
              status,
              note:          d.eventName,
            });
          }
          if (d.settledAmount > 0 && inDateRange(decorEventDate)) {
            results.push({
              id:            `decor-set-${d._id}`,
              source:        'Decors',
              type:          'income',
              amount:        d.settledAmount,
              category:      'Decoration Payment',
              reference:     d.customerName,
              venue,
              date:          decorEventDate,
              eventDate:     decorEventDate,
              paymentMethod: 'Cash',
              status:        'completed',
              note:          d.eventName,
            });
          }
        }

        if (!type || type === 'expense') {
          const decorCost = d.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
          if (decorCost > 0 && inDateRange(baseDate)) {
            results.push({
              id:            `decor-cost-${d._id}`,
              source:        'Decors',
              type:          'expense',
              amount:        decorCost,
              category:      'Decoration Expenses',
              reference:     d.customerName,
              venue,
              date:          baseDate,
              eventDate:     decorEventDate,
              paymentMethod: 'Cash',
              status:        'completed',
              note:          d.eventName,
            });
          }
        }
      }
    }

    // ── Employees ─────────────────────────────────────────────────────────────
    if (sources.includes('Employees')) {
      if (!type || type === 'expense') {
        const employees = await Employee.find();
        for (const emp of employees) {
          for (const ce of emp.cashEntries) {
            if (!inDateRange(ce.date)) continue;
            results.push({
              id:            `emp-cash-${emp._id}-${ce._id}`,
              source:        'Employees',
              type:          'expense',
              amount:        ce.amount,
              category:      ce.type === 'salary' ? 'Salaries' : ce.type === 'advance' ? 'Salary Advance' : 'Salary Deduction',
              reference:     emp.name,
              venue:         '',
              date:          ce.date,
              eventDate:     ce.date,
              paymentMethod: 'Cash',
              status:        'completed',
              note:          ce.note || emp.role,
            });
          }
        }
      }
    }

    // ── Rentals ───────────────────────────────────────────────────────────────
    if (sources.includes('Rentals')) {
      if (!type || type === 'income') {
        const rentals = await RentalEntry.find(
          from || to ? { eventDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}
        );
        for (const r of rentals) {
          const total = r.items.reduce(
            (s, i) => s + i.qtyGiven * i.pricePerItem + (i.penalty || 0),
            0
          );
          if (total <= 0) continue;
          const allReturned = r.items.every(i => i.returnStatus === 'returned');
          results.push({
            id:            `rental-${r._id}`,
            source:        'Rentals',
            type:          'income',
            amount:        total,
            category:      'Rental Income',
            reference:     r.customerName,
            venue:         r.venueLocation || '',
            date:          r.eventDate,
            eventDate:     r.eventDate,
            paymentMethod: 'Cash',
            status:        allReturned ? 'completed' : 'pending',
            note:          r.eventName,
          });
        }
      }
    }

    // ── Manual Transactions ───────────────────────────────────────────────────
    if (sources.includes('Manual')) {
      const filter = {};
      if (type) filter.type = type;
      if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
      const txs = await Transaction.find(filter);
      for (const tx of txs) {
        results.push({
          id:            `manual-${tx._id}`,
          source:        'Manual',
          type:          tx.type,
          amount:        tx.amount,
          category:      tx.category,
          reference:     '',
          venue:         tx.venue,
          date:          tx.date,
          eventDate:     tx.date,
          paymentMethod: tx.paymentMethod,
          status:        tx.status,
          note:          tx.comments,
        });
      }
    }

    results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json(results);
  } catch (err) { next(err); }
});

module.exports = router;
