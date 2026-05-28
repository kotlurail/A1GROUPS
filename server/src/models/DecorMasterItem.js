const { Schema, model } = require('mongoose');

const schema = new Schema(
  { name: { type: String, required: true, unique: true, trim: true } },
  { timestamps: true }
);
schema.index({ name: 1 });

module.exports = model('DecorMasterItem', schema);
