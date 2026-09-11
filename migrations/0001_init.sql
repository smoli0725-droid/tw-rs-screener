-- TradingVenator per-user profile + synced app data (Clerk user id as PK)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY,
  trades_json TEXT,
  settings_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
