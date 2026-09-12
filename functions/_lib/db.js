export function nowIso() {
  return new Date().toISOString();
}

export function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export async function upsertUser(db, userId) {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, plan, plan_expires_at, created_at, updated_at)
       VALUES (?, 'free', NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    )
    .bind(userId, ts, ts)
    .run();
  const row = await db
    .prepare(
      `SELECT id, plan, plan_expires_at, created_at, updated_at FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();
  return (
    row || {
      id: userId,
      plan: 'free',
      plan_expires_at: null,
      created_at: ts,
      updated_at: ts,
    }
  );
}

export async function getUserData(db, userId) {
  const row = await db
    .prepare(
      `SELECT trades_json, settings_json, updated_at FROM user_data WHERE user_id = ?`
    )
    .bind(userId)
    .first();
  if (!row) {
    return { trades: [], settings: {}, updated_at: null };
  }
  return {
    trades: parseJson(row.trades_json, []),
    settings: parseJson(row.settings_json, {}),
    updated_at: row.updated_at || null,
  };
}

export async function putUserData(db, userId, trades, settings) {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO user_data (user_id, trades_json, settings_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         trades_json = excluded.trades_json,
         settings_json = excluded.settings_json,
         updated_at = excluded.updated_at`
    )
    .bind(userId, JSON.stringify(trades), JSON.stringify(settings), ts)
    .run();
  return ts;
}
