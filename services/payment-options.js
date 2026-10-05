function cardTestEnabled() {
  return process.env.PAYMENT_MODE === "sandbox" && process.env.NODE_ENV !== "production";
}
function paymentOptions() {
  return { sandbox: process.env.PAYMENT_MODE === "sandbox", cod: true, esewa: ["ESEWA_SECRET_KEY", "ESEWA_PRODUCT_CODE", "ESEWA_GATEWAY_URL", "ESEWA_STATUS_URL", "APP_BASE_URL"]
    .every((key) => Boolean(process.env[key])), card: cardTestEnabled() };
}
module.exports = { paymentOptions, cardTestEnabled };
