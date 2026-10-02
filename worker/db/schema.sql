CREATE TABLE IF NOT EXISTS receipts (
 id TEXT PRIMARY KEY,
 schemaVersion INTEGER NOT NULL DEFAULT 1,
 verdictCode TEXT NOT NULL,
 score REAL,
 handle TEXT NOT NULL,
 claimedDateIso TEXT NOT NULL,
 snapshotTs TEXT NOT NULL,
 originalUrl TEXT NOT NULL,
 archiveSnippet TEXT NOT NULL DEFAULT '',
 fieldsEdited INTEGER NOT NULL DEFAULT 0,
 createdAt INTEGER NOT NULL
);
