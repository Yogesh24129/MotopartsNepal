/**
 * Server-side shopping cart logic.
 *
 * The cart lives in req.session.cart (persisted server-side by
 * connect-mongo, see server.js), so it is a genuine server-side
 * dynamic cart rather than something held only in the browser.
 *
 * Shape of req.session.cart:
 * {
 *   "<productId>": { productId, name, price, image, quantity },
 *   ...
 * }
 */

const SHIPPING_FEE = 150; // flat rate shipping in NPR, inside Kathmandu valley

function ensureCart(req) {
  if (!req.session.cart) {
    req.session.cart = {};
  }
  return req.session.cart;
}

function addItem(req, product, quantity = 1) {
  const cart = ensureCart(req);
  const id = product._id.toString();
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  if (cart[id]) {
    cart[id].quantity += qty;
  } else {
    cart[id] = {
      productId: id,
      name: product.name,
      price: product.price,
      image: product.image,
      stock: product.stock,
      quantity: qty,
    };
  }

  // never let cart quantity exceed available stock
  if (cart[id].quantity > product.stock) {
    cart[id].quantity = product.stock;
  }
}

function updateItem(req, productId, quantity) {
  const cart = ensureCart(req);
  const qty = parseInt(quantity, 10);

  if (!cart[productId]) return;

  if (isNaN(qty) || qty <= 0) {
    delete cart[productId];
  } else {
    cart[productId].quantity = qty;
  }
}

function removeItem(req, productId) {
  const cart = ensureCart(req);
  delete cart[productId];
}

function clearCart(req) {
  req.session.cart = {};
}

function getCartArray(req) {
  const cart = ensureCart(req);
  return Object.values(cart);
}

function getCartTotals(req) {
  const items = getCartArray(req);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const shippingFee = itemCount > 0 ? SHIPPING_FEE : 0;
  const total = subtotal + shippingFee;
  return { items, itemCount, subtotal, shippingFee, total };
}

// Attaches cart item count to every view (for the header badge)
function exposeCartCount(req, res, next) {
  const cart = ensureCart(req);
  res.locals.cartCount = Object.values(cart).reduce((sum, i) => sum + i.quantity, 0);
  next();
}

async function exposeCurrentUser(req, res, next) {
  if (req.session.userId) {
    const User = require("../models/User");
    res.locals.currentUser = await User.findById(req.session.userId).select("name email");
  } else {
    res.locals.currentUser = null;
  }
  next();
}

module.exports = {
  SHIPPING_FEE,
  ensureCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  getCartArray,
  getCartTotals,
  exposeCartCount,
  exposeCurrentUser,
};
