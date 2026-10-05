const nodemailer = require("nodemailer");
const twilio = require("twilio");
const { httpError } = require("../utils/validation");
function configured(channel) {
  return channel === "email" ? Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) :
    Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.SHIPPING_WHATSAPP_CONTENT_SID);
}
async function deliver(notice) {
  if (!configured(notice.channel)) throw httpError(503, "Configure the shipping notification provider first.");
  if (notice.channel === "email") {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    const result = await transport.sendMail({ from: process.env.GMAIL_USER, to: notice.recipient, subject: notice.subject, text: notice.body });
    if (!result.accepted || !result.accepted.length) throw new Error("Recipient was not accepted.");
    return result.messageId;
  }
  const result = await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM, to: "whatsapp:" + notice.recipient,
    contentSid: process.env.SHIPPING_WHATSAPP_CONTENT_SID,
    contentVariables: JSON.stringify({ "1": notice.subject, "2": notice.body.replace(/\s+/g, " ") }),
  });
  return result.sid;
}
module.exports = { configured, deliver };
