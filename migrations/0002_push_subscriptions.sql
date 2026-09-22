-- Web Push subscriptions for signed-in users (Clerk user id).
-- One row per browser endpoint. Disable deletes the row; 404/410 from the
-- push service deletes it too. alerts_enabled stays so a paused row can be
-- filtered without a later migration (v1 writes 1).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user
  ON push_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_push_sub_enabled
  ON push_subscriptions (alerts_enabled, user_id);
