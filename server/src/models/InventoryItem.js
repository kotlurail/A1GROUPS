const { Schema, model } = require('mongoose');

const inventoryItemSchema = new Schema(
  {
    name:          { type: String, required: true },
    category:      { type: String, required: true },
    venue:         { type: String, required: true },
    totalQty:      { type: Number, required: true, min: 0 },
    rentalPrice:   { type: Number, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    notes:         { type: String, default: '' },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ venue: 1, category: 1 });

module.exports = model('InventoryItem', inventoryItemSchema);
