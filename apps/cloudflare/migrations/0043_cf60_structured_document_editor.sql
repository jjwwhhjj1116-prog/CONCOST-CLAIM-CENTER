-- CF60: Keep the canonical Markdown text for exports/search while preserving the
-- Tiptap JSON document as the lossless authoring source.
ALTER TABLE preview_report_drafts ADD COLUMN editor_json TEXT;
ALTER TABLE preview_report_revisions ADD COLUMN editor_json TEXT;
