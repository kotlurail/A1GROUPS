const { Schema, model } = require('mongoose');

const paymentSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    mode:   { type: String, enum: ['Cash', 'PhonePay', 'Bank Transfer', 'Cheque', 'Other'], required: true },
    date:   { type: String, required: true },
    time:   { type: String, default: '' },
    note:   { type: String, default: '' },
  },
  { _id: true }
);

const expenseSchema = new Schema(
  { title: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } },
  { _id: true }
);

const extraBenefitSchema = new Schema(
  { name: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } },
  { _id: true }
);

const bookingSchema = new Schema(
  {
    venue:         { type: String, enum: ['A1 Function Hall', 'A1 Grand'], required: true },
    date:          { type: String, required: true },
    slot:          { type: String, enum: ['morning', 'evening'], required: true },
    eventName:     { type: String, required: true },
    guestCount:    { type: Number, default: 0 },
    amount:        { type: Number, default: 0 },
    payments:      [paymentSchema],
    status:        { type: String, enum: ['confirmed', 'pending', 'cancelled', 'paid'], default: 'pending' },
    client:        { type: String, required: true },
    phone:         { type: String, default: '' },
    startReading:  { type: Number, default: null },
    endReading:    { type: Number, default: null },
    acHours:       { type: Number, default: null },
    decorCost:     { type: Number, default: null },
    extraBenefits: [extraBenefitSchema],
    expenses:      [expenseSchema],
    discount:      { type: Number, default: null },
  },
  { timestamps: true }
);

bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ venue: 1, date: 1 });

module.exports = model('Booking', bookingSchema);
