const { Schema, model } = require('mongoose');

const transactionSchema = new Schema(
  {
    type:          { type: String, enum: ['income', 'expense'], required: true },
    amount:        { type: Number, required: true, min: 0 },
    category:      { type: String, required: true },
    venue:         { type: String, required: true },
    date:          { type: String, required: true },  // YYYY-MM-DD
    paymentMethod: { type: String, default: '' },
    comments:      { type: String, default: '' },
    status:        { type: String, enum: ['completed', 'pending', 'cancelled'], default: 'completed' },
  },
  { timestamps: true }
);

// Indexes for common filter queries
transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1, venue: 1 });

module.exports = model('Transaction', transactionSchema);
