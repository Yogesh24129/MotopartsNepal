const mongoose = require("mongoose");


const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: String,
    price: Number,
    quantity: Number,
    image: String,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    guestOwner: { type: String },
    marketingVisitor: { type: String, index: true },
    paidAt: { type: Date },
    items: [orderItemSchema],
    fulfillmentStatus: { type: String, enum: ["unfulfilled", "allocated", "stock_review"], default: "unfulfilled" },
    customer: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
      address: { type: String, required: true },
      city: { type: String, required: true },
    },
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true },
    integrityHash: { type: String },
    paymentMethod: {
      type: String,
      enum: ["esewa", "cod", "card"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    transactionId: { type: String },
    esewaTransactionUuid: { type: String, index: true },
    esewaTransactionUuids: { type: [String], index: true },
    // Only the last 4 digits are ever stored for the automated card test flow
    cardLast4: { type: String },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, paymentStatus: 1 });

module.exports = mongoose.model("Order", orderSchema);
