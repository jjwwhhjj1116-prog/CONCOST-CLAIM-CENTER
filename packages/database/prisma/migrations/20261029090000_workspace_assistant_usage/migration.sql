-- Only account/day counters; no questions, answers, keys or customer content.
CREATE TABLE IF NOT EXISTS WorkspaceAssistantUsage (
 organizationId TEXT NOT NULL,
 userId TEXT NOT NULL,
 quotaDay TEXT NOT NULL CHECK (length(quotaDay)=10),
 used INTEGER NOT NULL CHECK (used BETWEEN 1 AND 20),
 updatedAt TEXT NOT NULL,
 PRIMARY KEY (organizationId,userId,quotaDay)
);
