const crypto = require("crypto");

// Builds a stable, deterministic string from the order's core transaction
// data, then hashes it. Any change to items, amounts, or customer info
// will produce a completely different hash — proving the data hasn't
// been altered since the order was placed.
function generateOrderHash(order) {
  const payload = {
    items: order.items.map((i) => ({
      product: i.product ? i.product.toString() : null,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
    customer: {
      fullName: order.customer.fullName,
      phone: order.customer.phone,
      address: order.customer.address,
      city: order.customer.city,
    },
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
  };

  const stableString = JSON.stringify(payload);
  return crypto.createHash("sha256").update(stableString).digest("hex");
}

function verifyOrderHash(order) {
  const recomputed = generateOrderHash(order);
  return recomputed === order.integrityHash;
}

module.exports = { generateOrderHash, verifyOrderHash };