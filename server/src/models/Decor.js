const { Schema, model, Types } = require('mongoose');

const decorItemSchema = new Schema(
  { name: { type: String, default: '' }, quantity: { type: Number, default: 1 }, costPerUnit: { type: Number, default: 0 } },
  { _id: true }
);

const requiredItemSchema = new Schema(
  { name: { type: String, default: '' }, quantity: { type: Number, default: 1 }, description: { type: String, default: '' } },
  { _id: true }
);

const decorSchema = new Schema(
  {
    eventName:     { type: String, required: true },
    eventType:     { type: String, default: '' },
    customerName:  { type: String, required: true },
    mobile:        { type: String, required: true },
    eventDate:     { type: String, default: '' },
    location:      { type: String, default: '' },
    images:        [{ type: String }],
    decorItems:    [decorItemSchema],
    requiredItems: [requiredItemSchema],
    advanceAmount: { type: Number, default: 0 },
    settledAmount: { type: Number, default: 0 },
    quotedAmount:  { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['pending', 'partial', 'completed'], default: 'pending' },
    comments:      { type: String, default: '' },
    createdDate:   { type: String, default: '' },
    bookingId:     { type: Types.ObjectId, ref: 'Booking', default: null },
  },
  { timestamps: true }
);

decorSchema.index({ createdAt: -1 });
decorSchema.index({ eventType: 1 });
decorSchema.index({ paymentStatus: 1 });

module.exports = model('Decor', decorSchema);
