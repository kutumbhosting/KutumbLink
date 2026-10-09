import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.join(__dirname, "../../public/kutumb-logo.png");

/**
 * Returns a base64 data URL of a QR code encoding the given text
 * (used to render the QR in the browser popup + inline in emails).
 */
export async function generateQrDataUrl(text) {
  return QRCode.toDataURL(text, { width: 300, margin: 1 });
}

/**
 * Returns a raw PNG Buffer of a QR code encoding the given text
 * (used to embed the QR inside the generated PDF card).
 */
export async function generateQrPngBuffer(text) {
  return QRCode.toBuffer(text, { width: 300, margin: 1, type: "png" });
}

/**
 * Builds a printable membership / event-confirmation card as a PDF Buffer.
 * The QR code is placed in the top-right corner of the card.
 */
export function buildCardPdf({
  title = "Kutumb Membership Card",
  membershipNumber,
  name,
  email,
  phone,
  extraLines = [], // e.g. ["Event: Diwali Mela 2026", "Date: 12 Nov 2026"]
  qrPngBuffer,
}) {
  return new Promise((resolve, reject) => {
    const width = 380;
    const height = 240;
    const doc = new PDFDocument({ size: [width, height], margin: 24 });
    const chunks = [];

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Card border
    doc
      .roundedRect(6, 6, width - 12, height - 12, 12)
      .lineWidth(1.5)
      .strokeColor("#e0762c")
      .stroke();

    // Header - Kutumb logo (falls back to text if the file is ever missing)
    const logoWidth = 150;
    const logoHeight = Math.round((logoWidth * 439) / 1623); // preserve aspect ratio
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 22, 18, { width: logoWidth, height: logoHeight });
      doc.fillColor("#555").fontSize(10).font("Helvetica").text(title, 24, 18 + logoHeight + 4);
    } else {
      doc.fillColor("#7c3f00").fontSize(18).font("Helvetica-Bold").text("KUTUMB", 24, 22);
      doc.fillColor("#555").fontSize(10).font("Helvetica").text(title, 24, 44);
    }

    // QR code - top right corner
    const qrSize = 84;
    if (qrPngBuffer) {
      doc.image(qrPngBuffer, width - qrSize - 20, 18, { width: qrSize, height: qrSize });
    }

    // Divider
    doc
      .moveTo(24, 82)
      .lineTo(width - qrSize - 36, 82)
      .strokeColor("#eee")
      .stroke();

    // Details
    let y = 98;
    doc.fillColor("#000").fontSize(13).font("Helvetica-Bold");
    doc.text(`Membership No: ${membershipNumber}`, 24, y);
    y += 22;

    doc.font("Helvetica").fontSize(11).fillColor("#222");
    doc.text(`Name: ${name}`, 24, y);
    y += 18;
    doc.text(`Email: ${email}`, 24, y);
    y += 18;
    doc.text(`Phone: ${phone}`, 24, y);
    y += 18;

    for (const line of extraLines) {
      doc.text(line, 24, y);
      y += 18;
    }

    doc.fontSize(8).fillColor("#999").text(
      "This card confirms Kutumb community membership / event registration.",
      24,
      height - 26,
      { width: width - 48 }
    );

    doc.end();
  });
}

/**
 * Builds one PDF with a separate ticket "page" per attendee on a paid or
 * free event registration — the primary registrant, each additional adult,
 * and each child (under-5 and 5+) all get their own page with their own
 * scannable QR code, so the group can be checked in as individuals at the
 * door rather than needing to arrive together with one shared code.
 *
 * `attendees` — [{ name, category, qrPngBuffer }], in the order they
 * should appear (see CATEGORY_LABELS below for how `category` is
 * displayed).
 */
const CATEGORY_LABELS = {
  primary_adult: "Registrant",
  adult: "Additional Adult",
  child_under5: "Child (Under 5)",
  child_5plus: "Child (5+)",
};

export function buildEventTicketsPdf({
  eventName,
  eventDate,
  registrationNumber,
  attendees, // [{ name, category, qrPngBuffer }]
}) {
  return new Promise((resolve, reject) => {
    const width = 380;
    const height = 520;
    // A small bottom margin, not the usual 24 — this is a fixed-size card
    // layout with every element placed at an explicit y, not flowing text,
    // but PDFKit still auto-inserts a page break if a .text() call's
    // computed height would cross the bottom margin boundary. The footer
    // line sits right around that boundary at a 24px margin, which was
    // silently producing one extra blank page per attendee.
    const pageOptions = { size: [width, height], margins: { top: 24, left: 24, right: 24, bottom: 8 } };
    const doc = new PDFDocument(pageOptions);
    const chunks = [];

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    attendees.forEach((attendee, index) => {
      if (index > 0) doc.addPage(pageOptions);

      // Card border
      doc.roundedRect(6, 6, width - 12, height - 12, 12).lineWidth(1.5).strokeColor("#e0762c").stroke();

      // Header — logo (falls back to plain text if the file is missing)
      const logoWidth = 150;
      const logoHeight = Math.round((logoWidth * 439) / 1623);
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, 24, 22, { width: logoWidth, height: logoHeight });
      } else {
        doc.fillColor("#7c3f00").fontSize(18).font("Helvetica-Bold").text("KUTUMB", 24, 24);
      }

      doc.fillColor("#7c3f00").fontSize(16).font("Helvetica-Bold").text("Event Ticket", 24, 74);

      let y = 100;
      doc.fillColor("#000").fontSize(14).font("Helvetica-Bold").text(eventName, 24, y, { width: width - 48 });
      y += doc.heightOfString(eventName, { width: width - 48 }) + 4;

      if (eventDate) {
        doc.fillColor("#555").fontSize(11).font("Helvetica").text(eventDate, 24, y);
        y += 18;
      }

      y += 8;
      doc.moveTo(24, y).lineTo(width - 24, y).strokeColor("#eee").stroke();
      y += 16;

      // QR code, centered
      const qrSize = 180;
      doc.image(attendee.qrPngBuffer, (width - qrSize) / 2, y, { width: qrSize, height: qrSize });
      y += qrSize + 18;

      doc.fillColor("#000").fontSize(13).font("Helvetica-Bold").text(attendee.name, 24, y, {
        width: width - 48,
        align: "center",
      });
      y += 20;

      doc.fillColor("#b45309").fontSize(11).font("Helvetica-Bold").text(
        CATEGORY_LABELS[attendee.category] || "Attendee",
        24,
        y,
        { width: width - 48, align: "center" }
      );
      y += 22;

      if (registrationNumber) {
        doc.fillColor("#555").fontSize(10).font("Helvetica").text(
          `Registration: ${registrationNumber}`,
          24,
          y,
          { width: width - 48, align: "center" }
        );
      }

      doc.fillColor("#999").fontSize(8).text(
        "Present this QR code at check-in. One scan per ticket.",
        24,
        height - 30,
        { width: width - 48, align: "center" }
      );
    });

    doc.end();
  });
}
