// Shared with server.js and ticketing.routes.js so an event's ticketing
// records (event_id column) always match the same slug the rest of the
// app derives from an event's title.
export const slugify = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^\w-]+/g, "");
