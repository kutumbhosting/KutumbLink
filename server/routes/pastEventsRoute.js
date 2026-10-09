import express from "express";
import { pool } from "../db/pool.js";
import { sortPastEventsDescending } from "../lib/eventDates.js";

const router = express.Router();

// GET /api/pastevents - returns events sorted with the most recent first,
// each with its media array attached (joined from kutumb_past_event_media).
router.get("/", async (req, res) => {
  try {
    const { rows: events } = await pool.query("SELECT * FROM kutumb_past_events ORDER BY id");
    const { rows: media } = await pool.query("SELECT * FROM kutumb_past_event_media ORDER BY past_event_id, sort_order");

    const mediaByEvent = {};
    for (const m of media) {
      if (!mediaByEvent[m.past_event_id]) mediaByEvent[m.past_event_id] = [];
      mediaByEvent[m.past_event_id].push({ type: m.type, src: m.src });
    }

    const shaped = events.map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date_text,
      description: e.description,
      highlights: e.highlights,
      media: mediaByEvent[e.id] || [],
    }));

    res.json(sortPastEventsDescending(shaped));
  } catch (err) {
    console.error("PAST EVENTS ERROR:", err);
    res.status(500).json([]);
  }
});

export default router;
