// server/routes/manuals.routes.js
//
// User manuals (PDF) for the Admin Console → "Manuals" tab.
//
// The PDFs live in <DATA_ROOT>/manuals (server/runtime-data/manuals by default), so
// they can be replaced from Admin → Data Management → File Management
// (folder "manuals") without a code change. Any extra PDF dropped into that
// folder is listed too.
//
import { Router } from "express";
import fs from "fs";
import path from "path";
import { DATA_ROOT } from "../lib/dataRoot.js";
import { requireAdmin } from "../lib/auth.js";

const router = Router();
const MANUALS_DIR = path.join(DATA_ROOT, "manuals");

/** Known manuals, in display order. id is what the URL uses. */
const KNOWN = [
  {
    id: "admin-console",
    file: "Kutumb-Admin-Console-Manual.pdf",
    title: "Admin Console User Manual",
    description:
      "For administrators and volunteers: logging in and roles, members, bank, events, registrations, coupons, " +
      "QR check-in, payments, automatic reminders and cancellation, settings and troubleshooting.",
    audience: "Admins",
  },
  {
    id: "membership-booking",
    file: "Kutumb-Membership-and-Event-Booking-Guide.pdf",
    title: "Membership & Event Booking Guide",
    description:
      "For members and guests: joining Kutumb for free, registering for events, paying by card, coupon " +
      "(full or part) or bank transfer, tickets, reminders and FAQs. Suitable to share with the community.",
    audience: "Members & guests",
  },
];

// Manuals anyone may read WITHOUT logging in (linked as "User Manual" in the
// website footer). The admin manual is deliberately NOT here.
export const PUBLIC_MANUAL_IDS = ["membership-booking"];
export const PUBLIC_MANUAL_PATH = "/user-manual";

const isPdf = (name) => /\.pdf$/i.test(name);
const slug = (name) => name.replace(/\.pdf$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every manual currently available: known ones first, then any extra PDFs. */
function listManuals() {
  const files = fs.existsSync(MANUALS_DIR) ? fs.readdirSync(MANUALS_DIR).filter(isPdf) : [];
  const out = [];
  for (const k of KNOWN) {
    if (files.includes(k.file)) out.push({ ...k });
  }
  for (const f of files) {
    if (KNOWN.some((k) => k.file === f)) continue;
    out.push({ id: slug(f), file: f, title: f.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "), description: "", audience: "" });
  }
  return out.map((m) => {
    const st = fs.statSync(path.join(MANUALS_DIR, m.file));
    return {
      ...m,
      sizeBytes: st.size,
      updatedAt: st.mtime.toISOString(),
      url: `/api/manuals/${m.id}`,
      publicUrl: PUBLIC_MANUAL_IDS.includes(m.id) ? PUBLIC_MANUAL_PATH : null,
    };
  });
}

router.get("/", requireAdmin, (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(listManuals());
  } catch (err) {
    console.error("MANUALS LIST ERROR:", err);
    res.status(500).json({ message: "Could not list manuals" });
  }
});

function sendManual(res, manual, download) {
  const full = path.resolve(MANUALS_DIR, manual.file);
  if (!full.startsWith(path.resolve(MANUALS_DIR) + path.sep)) return res.status(400).json({ message: "Bad path" });
  const disposition = download ? "attachment" : "inline";
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${manual.file.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.sendFile(full);
}

// GET /api/manuals/:id            → opens in the browser (inline)
// GET /api/manuals/:id?download=1 → downloads the PDF
router.get("/:id", requireAdmin, (req, res) => {
  const manual = listManuals().find((m) => m.id === req.params.id);
  if (!manual) return res.status(404).json({ message: "Manual not found" });
  sendManual(res, manual, !!req.query.download);
});

/**
 * PUBLIC (no login): the Membership & Event Booking Guide, served at
 * /user-manual (mounted in server.js). Only ids in PUBLIC_MANUAL_IDS can
 * ever be reached this way. ?download=1 downloads instead of opening.
 */
export function servePublicManual(req, res) {
  try {
    const manual = listManuals().find((m) => PUBLIC_MANUAL_IDS.includes(m.id));
    if (!manual) return res.status(404).send("The user manual isn't available right now. Please try again later.");
    sendManual(res, manual, !!req.query.download);
  } catch (err) {
    console.error("PUBLIC MANUAL ERROR:", err);
    res.status(500).send("Could not open the user manual");
  }
}

export default router;
