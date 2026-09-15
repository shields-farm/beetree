-- 010_media_files.sql — store media on the filesystem, not as base64 in SQLite.
--
-- Why: media_items.dataUrl held a full base64 data URL in the row. A 12 MP
-- JPEG from the Mentra Live glasses is ~4-6 MB, which is ~6-8 MB as base64,
-- and the product target is a Pi 5 with a 64 GB microSD. Fifty capture photos
-- would add ~300 MB to the database and inflate the WAL on every write.
--
-- New shape: the JPEG lives at data/media/<entity_id>.jpg and `dataUrl` holds
-- a relative URL (/media/<entity_id>.jpg). The frontend renders
-- <img src={item.dataUrl}>, so a relative URL needs no component change.
--
-- file_path is the on-disk name for deletion. It is NULL for legacy rows that
-- still carry an inline data URL — those keep working unchanged.
ALTER TABLE media_items ADD COLUMN file_path TEXT;

-- Retention pruning scans (hive, newest-first) on every capture.
CREATE INDEX IF NOT EXISTS idx_media_hive_ts
  ON media_items(hiveId, timestamp DESC) WHERE superseded_by IS NULL;
