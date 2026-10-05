const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendDeliveryConfirmation(order) {
  try {
    if (!order.customer.email || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.log("[Email] Email confirmation not configured or recipient missing, skipping.");
      return;
    }

    const orderCode = order._id.toString().slice(-6).toUpperCase();

    await transporter.sendMail({
      from: `"MotoParts Nepal" <${process.env.GMAIL_USER}>`,
      to: order.customer.email,
      subject: `Order Confirmed — #${orderCode}`,
      html: `
        <div style="font-family:sans-serif; max-width:480px; margin:auto;">
          <h2 style="color:#ff5a1f;">MotoParts Nepal</h2>
          <p>Hi ${escapeHtml(order.customer.fullName)},</p>
          <p>Your order <strong>#${orderCode}</strong> has been placed successfully.</p>
          <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            ${order.items
              .map(
                (item) => `
              <tr>
                <td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(item.name)} &times; ${item.quantity}</td>
                <td style="padding:6px 0; border-bottom:1px solid #eee; text-align:right;">Rs. ${item.price * item.quantity}</td>
              </tr>`
              )
              .join("")}
          </table>
          <p><strong>Total: Rs. ${order.total}</strong></p>
          <p>Delivery to: ${escapeHtml(order.customer.address)}, ${escapeHtml(order.customer.city)}</p>
          <p style="color:#888; font-size:0.85rem; margin-top:24px;">Thank you for shopping with MotoParts Nepal.</p>
        </div>
      `,
    });

    console.log(`[Email] Delivery confirmation sent to ${order.customer.email}`);
  } catch (err) {
    // Never let an email failure break checkout — just log it
    console.error("[Email] Failed to send delivery confirmation:", err.message);
  }
}

module.exports = { sendDeliveryConfirmation };