const nodemailer = require("nodemailer");

const { httpError } = require("../utils/validation");
function configured(channel) {
  return channel === "email" ? Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) :
    channel === "whatsapp";
}
async function deliver(notice) {
  if (!configured(notice.channel)) throw httpError(503, "Configure the shipping notification provider first.");
  if (notice.channel === "email") {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    const result = await transport.sendMail({ from: process.env.GMAIL_USER, to: notice.recipient, subject: notice.subject, text: notice.body });
    if (!result.accepted || !result.accepted.length) throw new Error("Recipient was not accepted.");
    return result.messageId;
  }
  throw httpError(400, "Open WhatsApp to send this notice manually.");
}
function whatsappUrl(recipient, body) {
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) throw httpError(400, "Enter a valid WhatsApp number with its country code.");
  return "https://wa.me/" + recipient.slice(1) + "?text=" + encodeURIComponent(body);
}
module.exports = { configured, deliver, whatsappUrl };
