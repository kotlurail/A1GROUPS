require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const transactionRoutes = require('./routes/transactions');
const inventoryRoutes   = require('./routes/inventory');
const rentalRoutes      = require('./routes/rentals');
const eventRoutes       = require('./routes/events');
const uploadRoutes      = require('./routes/upload');
const employeeRoutes    = require('./routes/employees');
const decorRoutes       = require('./routes/decors');
const bookingRoutes     = require('./routes/bookings');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/transactions', transactionRoutes);
app.use('/api/inventory',    inventoryRoutes);
app.use('/api/rentals',      rentalRoutes);
app.use('/api/events',       eventRoutes);
app.use('/api/upload',       uploadRoutes);
app.use('/api/employees',    employeeRoutes);
app.use('/api/decors',       decorRoutes);
app.use('/api/bookings',     bookingRoutes);

app.get('/', (_req, res) => res.json({ status: 'A1 Groups API running' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── MongoDB + listen ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
