const crypto = require("crypto");
const { httpError } = require("./validation");

const SECRET_KEY = process.env.ESEWA_SECRET_KEY;
const PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE;
const GATEWAY_FORM_URL = process.env.ESEWA_GATEWAY_URL;
const STATUS_URL = process.env.ESEWA_STATUS_URL;

function requireConfiguration() {
  if (!SECRET_KEY || !PRODUCT_CODE || !GATEWAY_FORM_URL || !STATUS_URL || !process.env.APP_BASE_URL) {
    throw httpError(503, "eSewa is not configured. Please choose another payment method.");
  }
}

function generateSignature(totalAmount, transactionUuid) {
  requireConfiguration();
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${PRODUCT_CODE}`;
  return crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
}

function verifySignature(payload) {
  if (!SECRET_KEY || !payload || typeof payload.signed_field_names !== "string" || typeof payload.signature !== "string") return false;
  const fields = payload.signed_field_names.split(",");
  if (new Set(fields).size !== fields.length || !["transaction_uuid", "total_amount", "product_code", "status"].every((name) => fields.includes(name))) return false;
  if (!fields.every((field) => /^[a-z_]+$/.test(field) && ["string", "number"].includes(typeof payload[field]))) return false;
  if (payload.product_code !== PRODUCT_CODE) return false;
  const message = fields.map((field) => `${field}=${payload[field]}`).join(",");
  const expected = crypto.createHmac("sha256", SECRET_KEY).update(message).digest();
  const supplied = Buffer.from(payload.signature, "base64");
  return /^[A-Za-z0-9+/]+={0,2}$/.test(payload.signature) && supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

function decodeResponse(data) {
  if (typeof data !== "string" || data.length > 10000) throw httpError(400, "Invalid eSewa response.");
  let payload;
  try { payload = JSON.parse(Buffer.from(data, "base64").toString("utf8")); }
  catch { throw httpError(400, "Invalid eSewa response."); }
  if (!verifySignature(payload)) throw httpError(400, "eSewa response signature did not match.");
  return payload;
}

async function checkTransactionStatus(totalAmount, transactionUuid) {
  requireConfiguration();
  const url = new URL(STATUS_URL);
  url.search = new URLSearchParams({ product_code: PRODUCT_CODE, total_amount: String(totalAmount), transaction_uuid: transactionUuid });
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw httpError(502, "eSewa verification is temporarily unavailable. Please retry.");
  return response.json();
}

function validateStatus(result, amount, uuid) {
  if (!result || result.transaction_uuid !== uuid || result.product_code !== PRODUCT_CODE ||
      Number(result.total_amount) !== Number(amount) || typeof result.status !== "string" ||
      (result.status === "COMPLETE" && (typeof result.ref_id !== "string" || !result.ref_id))) {
    throw httpError(400, "eSewa verification details do not match this payment.");
  }
}

function paymentFields(amount, uuid, successPath, failurePath) {
  requireConfiguration();
  return { amount, tax_amount: 0, total_amount: amount, transaction_uuid: uuid, product_code: PRODUCT_CODE,
    product_service_charge: 0, product_delivery_charge: 0,
    success_url: new URL(successPath, process.env.APP_BASE_URL).href,
    failure_url: new URL(failurePath, process.env.APP_BASE_URL).href,
    signed_field_names: "total_amount,transaction_uuid,product_code", signature: generateSignature(amount, uuid) };
}

module.exports = { PRODUCT_CODE, GATEWAY_FORM_URL, generateSignature, verifySignature, checkTransactionStatus,
  decodeResponse, validateStatus, paymentFields, requireConfiguration };
