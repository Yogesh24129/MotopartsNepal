function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function money(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents) ||
      Math.abs(amount * 100 - cents) > 0.000001 || amount > 1000000) return null;
  return cents / 100;
}

function quantity(value, allowZero = false) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= (allowZero ? 0 : 1) ? result : null;
}

module.exports = { httpError, money, quantity };
