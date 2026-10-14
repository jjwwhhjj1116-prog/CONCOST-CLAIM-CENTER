-- SQLite already has the immutable assignedReviewerId (P12). Add the same
-- recipient/date lookup index as D1; preserve all existing events and users.
CREATE INDEX IF NOT EXISTS "ReportReviewRequest_assignedReviewerId_createdAt_idx"
ON "ReportReviewRequest"("assignedReviewerId", "createdAt");
