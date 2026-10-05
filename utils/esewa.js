const crypto = require("crypto");

const SECRET_KEY = process.env.ESEWA_SECRET_KEY;
const PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE;
const GATEWAY_FORM_URL = process.env.ESEWA_GATEWAY_URL;
const STATUS_URL = process.env.ESEWA_STATUS_URL;

// eSewa signs: "total_amount=X,transaction_uuid=Y,product_code=Z" -> HMAC-SHA256 -> base64
function generateSignature(totalAmount, transactionUuid) {
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${PRODUCT_CODE}`;
  return crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
}

// Verifies the signed response eSewa sends back after payment
function verifySignature(payload) {
  const fields = payload.signed_field_names.split(",");
  const message = fields.map((f) => `${f}=${payload[f]}`).join(",");
  const expected = crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
  return expected === payload.signature;
}

// Defense in depth: never trust the redirect alone — confirm with eSewa directly
async function checkTransactionStatus(totalAmount, transactionUuid) {
  const url = `${STATUS_URL}?product_code=${PRODUCT_CODE}&total_amount=${totalAmount}&transaction_uuid=${transactionUuid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`eSewa status check failed: ${res.status}`);
  return res.json(); // { status: "COMPLETE" | "PENDING" | "NOT FOUND" | ..., ref_id, ... }
}

module.exports = { PRODUCT_CODE, GATEWAY_FORM_URL, generateSignature, verifySignature, checkTransactionStatus };