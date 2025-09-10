import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema({
  email: String,
  amount: Number,
  vpsId: String,
  os: String,
  status: { type: String, default: "pending" },
  paymentId: String,
  payerId: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Transaction", TransactionSchema);
