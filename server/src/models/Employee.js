const { Schema, model } = require('mongoose');

const attendanceSchema = new Schema(
  { date: { type: String, required: true }, status: { type: String, enum: ['present','absent','half','holiday'], required: true } },
  { _id: false }
);

const cashEntrySchema = new Schema(
  {
    date:   { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    note:   { type: String, default: '' },
    type:   { type: String, enum: ['advance','salary','deduction'], required: true },
  },
  { timestamps: true }
);

const employeeSchema = new Schema(
  {
    name:          { type: String, required: true },
    role:          { type: String, required: true },
    phone:         { type: String, default: '' },
    monthlySalary: { type: Number, required: true, min: 0 },
    workingDays:   { type: Number, default: 26 },
    joinDate:      { type: String, default: '' },
    periodStart:   { type: String, default: '' },
    periodEnd:     { type: String, default: '' },
    attendance:    [attendanceSchema],
    cashEntries:   [cashEntrySchema],
  },
  { timestamps: true }
);

employeeSchema.index({ createdAt: -1 });

module.exports = model('Employee', employeeSchema);
