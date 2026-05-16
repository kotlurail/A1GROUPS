const { Schema, model, Types } = require('mongoose');

const rentalItemSchema = new Schema(
  {
    itemId:       { type: Types.ObjectId, ref: 'InventoryItem', required: false, default: null },
    itemName:     { type: String, required: true },   // denormalised for display speed
    venue:        { type: String, default: '' },
    qtyGiven:     { type: Number, required: true, min: 1 },
    pricePerItem: { type: Number, default: 0 },
    returnStatus: { type: String, enum: ['pending', 'partial', 'returned'], default: 'pending' },
    qtyReturned:  { type: Number, default: 0 },
    returnCond:   { type: String, enum: ['Good', 'Fair', 'Damaged'], default: 'Good' },
    damageNotes:  { type: String, default: '' },
    penalty:      { type: Number, default: 0 },
    returnDate:   { type: String, default: '' },
  },
  { _id: true }
);

const rentalEntrySchema = new Schema(
  {
    customerName:  { type: String, required: true },
    mobile:        { type: String, required: true },
    eventName:     { type: String, required: true },
    eventType:     { type: String, default: '' },
    eventDate:     { type: String, required: true },
    venueLocation: { type: String, default: '' },
    returnDate:    { type: String, default: '' },
    comments:      { type: String, default: '' },
    items:         [rentalItemSchema],
  },
  { timestamps: true }
);

rentalEntrySchema.index({ eventDate: -1 });
rentalEntrySchema.index({ 'items.returnStatus': 1 });

module.exports = model('RentalEntry', rentalEntrySchema);
