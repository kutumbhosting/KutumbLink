// server/routes/registrationEmails.routes.js — mounted at /api/registration-emails
//
//   GET  /status   — settings in effect, last activity, 30-day counts
//   GET  /preview  — dry run: what would be sent / cancelled right now
//   POST /run-now  — run immediately (ignores the "not before hour X" rule)
//   GET  /events   — upcoming events with their per-event ticks
//   PUT  /events/:id — { autoReminders?, autoCancel?, autoWelcome? }

import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { runRegistrationEmails, getSchedulerStatus, listEventsForEmails } from "../lib/registrationScheduler.js";
import { pool } from "../db/pool.js";

const router = Router();
router.use(requireAdmin);

router.get("/status", async (req, res) => {
  try {
    res.json(await getSchedulerStatus());
  } catch (err) {
    console.error("REG EMAILS STATUS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/preview", async (req, res) => {
  try {
    res.json(await runRegistrationEmails({ dryRun: true, force: true }));
  } catch (err) {
    console.error("REG EMAILS PREVIEW ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.post("/run-now", async (req, res) => {
  try {
    res.json(await runRegistrationEmails({ force: true }));
  } catch (err) {
    console.error("REG EMAILS RUN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/events", async (req, res) => {
  try {
    res.json(await listEventsForEmails());
  } catch (err) {
    console.error("REG EMAILS EVENTS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.put("/events/:id", async (req, res) => {
  try {
    const map = { autoReminders: "auto_reminders", autoCancel: "auto_cancel", autoWelcome: "auto_welcome" };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (typeof req.body?.[k] === "boolean") {
        vals.push(req.body[k]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ message: "Nothing to change" });
    vals.push(Number(req.params.id));
    const { rows } = await pool.query(
      `UPDATE kutumb_upcoming_events SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}
       RETURNING id, title, auto_reminders, auto_cancel, auto_welcome`,
      vals
    );
    if (!rows.length) return res.status(404).json({ message: "Event not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("REG EMAILS EVENT UPDATE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
