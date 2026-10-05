const twilio = require("twilio");



// Converts a Nepali local number ("98XXXXXXXX") into E.164 format (+977XXXXXXXXXX)
function toE164Nepal(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("977")) return `+${digits}`;
  return `+977${digits}`;
}

async function sendWhatsAppConfirmation(order) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log("[WhatsApp] Twilio credentials not configured, skipping.");
      return;
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const to = `whatsapp:${toE164Nepal(order.customer.phone)}`;

    const message = await client.messages.create({
      to,
      from: process.env.TWILIO_WHATSAPP_FROM,
      contentSid: process.env.TWILIO_CONTENT_SID,
    });

    console.log(`[WhatsApp] Delivery confirmation sent to ${to} (sid: ${message.sid})`);
  } catch (err) {
    // Never let a WhatsApp failure break checkout — just log it
    console.error("[WhatsApp] Failed to send delivery confirmation:", err.message);
  }
}

module.exports = { sendWhatsAppConfirmation };