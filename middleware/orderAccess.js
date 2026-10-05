const mongoose = require("mongoose");
const Order = require("../models/Order");
const { httpError } = require("../utils/validation");

function ownsOrder(req, order) {
  if (order.user) return String(order.user) === String(req.session.userId || "");
  return Boolean(order.guestOwner && order.guestOwner === req.session.checkoutOwner);
}

async function loadOrder(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.orderId)) throw httpError(404, "Order not found.");
    const order = await Order.findById(req.params.orderId);
    if (!order || !ownsOrder(req, order)) throw httpError(404, "Order not found.");
    req.order = order;
    next();
  } catch (error) {
    next(error);
  }
}

function paymentMethod(method) {
  return (req, res, next) => {
    if (req.order.paymentMethod !== method) return next(httpError(400, "Use the payment method selected at checkout."));
    next();
  };
}

module.exports = { loadOrder, ownsOrder, paymentMethod };
