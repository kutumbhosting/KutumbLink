/**
 * Sends a document (the membership/event card PDF) over WhatsApp using
 * Meta's WhatsApp Cloud API, from the Kutumb business WhatsApp number
 * (+61409809164, registered against WHATSAPP_PHONE_NUMBER_ID in Meta
 * Business Manager - see .env.example for the credentials required).
 *
 * NOTE: Meta's servers must be able to reach `pdfUrl` over the public
 * internet to download the document, so this only works once the app is
 * deployed behind a public URL (PUBLIC_BASE_URL). It will not work against
 * http://localhost.
 */
export async function sendWhatsAppDocument({ to, pdfUrl, filename, caption }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    return {
      sent: false,
      error:
        "WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env (see .env.example).",
    };
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "document",
    document: { link: pdfUrl, filename, caption },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    let data = null;
    let rawText = null;
    try {
      data = await res.json();
    } catch {
      rawText = await res.text().catch(() => null);
    }

    if (!res.ok) {
      console.error(
        "WHATSAPP API ERROR:",
        data ? JSON.stringify(data, null, 2) : `Non-JSON response (HTTP ${res.status}): ${rawText}`
      );
      return {
        sent: false,
        error: data?.error?.message || rawText || `WhatsApp send failed (HTTP ${res.status})`,
        errorCode: data?.error?.code,
        errorSubcode: data?.error?.error_subcode,
      };
    }

    return { sent: true, data };
  } catch (err) {
    console.error("WHATSAPP SEND ERROR:", err.message);
    return { sent: false, error: err.message };
  }
}

function normalizePhone(p) {
  // WhatsApp Cloud API expects digits only, no "+"
  return (p || "").toString().replace(/[^\d+]/g, "").replace(/^\+/, "");
}
