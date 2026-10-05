const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    brand: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        "Engine Parts",
        "Brakes",
        "Tyres & Wheels",
        "Electrical",
        "Body & Frame",
        "Helmets & Gear",
        "Accessories",
        "Lubricants",
      ],
    },
    compatibleModels: [{ type: String, trim: true }], // e.g. "Bajaj Pulsar 150"
    price: { type: Number, required: true, min: 0 }, // price in NPR
    stock: { type: Number, required: true, min: 0, default: 0 },
    image: { type: String, default: "/images/placeholder-part.svg" },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
