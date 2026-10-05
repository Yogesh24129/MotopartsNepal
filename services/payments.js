const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { verifyOrderHash } = require("../utils/hash");
const { httpError } = require("../utils/validation");

// Payment status and inventory commit together. MongoDB retries write conflicts,
// so concurrent callbacks see the already-paid order without deducting again.
async function finalizeOrder(orderId, status, transactionId, options = {}) {
  return mongoose.connection.transaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw httpError(404, "Order not found.");
    if (order.shippingStatus === "cancelled" && order.paymentMethod !== "esewa") throw httpError(409, "This order was cancelled.");
    if (options.method && order.paymentMethod !== options.method) throw httpError(400, "Payment method mismatch.");
    if (options.uuid && order.esewaTransactionUuid !== options.uuid && !order.esewaTransactionUuids.includes(options.uuid)) throw httpError(400, "Payment attempt no longer matches this order.");
    if (order.paymentStatus === "paid") return { order, changed: false };
    if (!verifyOrderHash(order)) throw httpError(409, "Order details changed. Please contact support before paying.");
    if (status === "failed" && order.paymentStatus === "failed") return { order, changed: false };

    if (status === "paid") {
      order.paidAt = new Date();
      const products = await Product.find({ _id: { $in: order.items.map((item) => item.product) } }).session(session);
      const stock = new Map(products.map((product) => [String(product._id), product.stock]));
      const available = order.items.every((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
        stock.has(String(item.product)) && stock.get(String(item.product)) >= item.quantity);
      // A confirmed external payment must stay paid even if stock sold out while
      // the buyer was at the gateway. Flag it for fulfillment/refund review.
      order.fulfillmentStatus = order.shippingStatus === "cancelled" ? "stock_review" : order.paymentMethod === "cod" && order.fulfillmentStatus === "allocated" ? "allocated" : available ? "allocated" : "stock_review";
      if (available && order.paymentMethod !== "cod" && order.shippingStatus !== "cancelled") {
        for (const item of order.items) {
          const result = await Product.updateOne(
            { _id: item.product, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } }, { session }
          );
          if (result.modifiedCount !== 1) throw httpError(409, "Stock changed while confirming payment. Please retry confirmation.");
        }
      }
    }
    order.paymentStatus = status;
    order.transactionId = transactionId;
    if (options.cardLast4) order.cardLast4 = options.cardLast4;
    await order.save({ session });
    return { order, changed: true };
  });
}

module.exports = { finalizeOrder };
