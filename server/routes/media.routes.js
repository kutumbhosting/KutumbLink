import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

// Serves flyer/past-event images and videos directly from Postgres
// (kutumb_media_files), replacing the old express.static file serving.
// Supports HTTP Range requests so <video> elements can still seek/scrub
// properly instead of only being able to play straight through.
router.get("/:filename", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT mimetype, size_bytes, data FROM kutumb_media_files WHERE filename = $1",
      [req.params.filename]
    );
    const file = rows[0];
    if (!file) return res.status(404).send("Not found");

    const { mimetype, size_bytes: size, data } = file;
    res.setHeader("Content-Type", mimetype);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // filenames are unique per upload — safe to cache forever

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      let start = match?.[1] ? parseInt(match[1], 10) : 0;
      let end = match?.[2] ? parseInt(match[2], 10) : size - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= size) end = size - 1;

      if (start > end || start >= size) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`);
        return res.end();
      }

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return res.end(data.subarray(start, end + 1));
    }

    res.setHeader("Content-Length", size);
    res.end(data);
  } catch (err) {
    console.error("MEDIA SERVE ERROR:", err);
    res.status(500).send("Server error");
  }
});

export default router;
