-- One-off fix for databases that were already seeded before seed.sql's
-- image1 values were corrected (see the matching fix in seed.sql — this
-- file exists only because seed.sql itself never re-runs against a
-- database that already has rows in kutumb_activities).
--
-- Run this once against your live database, e.g.:
--   psql "$DATABASE_URL" -f server/db/fix-activity-images.sql
-- It's safe to run more than once (WHERE ... IS NULL guards every row).

UPDATE kutumb_activities SET image1 = 'food-service.jpeg'
  WHERE title = 'Kutumb Food Distribution' AND image1 IS NULL;

UPDATE kutumb_activities SET image1 = 'bhajan.jpeg'
  WHERE title = 'Kutumb Bhajan Sandhya' AND image1 IS NULL;

UPDATE kutumb_activities SET image1 = 'menshed.jpeg'
  WHERE title = 'Kutumb Men Shed' AND image1 IS NULL;
