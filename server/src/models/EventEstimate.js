const { Schema, model } = require('mongoose');

const decorItemSchema = new Schema(
  {
    name:     { type: String, default: '' },
    qty:      { type: Number, default: 1 },
    unitCost: { type: Number, default: 0 },
    comment:  { type: String, default: '' },
  },
  { _id: true }
);

const decorSectionSchema = new Schema(
  {
    heading:  { type: String, default: '' },
    images:   [{ type: String }],   // Cloudinary secure URLs
    taxPct:   { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    items:    [decorItemSchema],
    comment:  { type: String, default: '' },
  },
  { _id: true }
);

const eventEstimateSchema = new Schema(
  {
    eventName:    { type: String, required: true },
    customerName: { type: String, required: true },
    mobile:       { type: String, required: true },
    eventDate:    { type: String, required: true },
    location:     { type: String, default: '' },
    eventType:    { type: String, required: true },
    advance:      { type: Number, default: 0 },
    quotedAmount: { type: Number, default: 0 },
    decors:       [decorSectionSchema],
  },
  { timestamps: true }
);

eventEstimateSchema.index({ createdAt: -1 });
eventEstimateSchema.index({ eventType: 1 });

module.exports = model('EventEstimate', eventEstimateSchema);
