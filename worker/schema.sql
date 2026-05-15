CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id    TEXT UNIQUE NOT NULL,
  github_login TEXT NOT NULL,
  aihubmix_key TEXT,
  ao3_username TEXT,
  ao3_password TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  last_active  TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id),
  fandoms                  TEXT DEFAULT '[]',
  taste_profile            TEXT DEFAULT '{}',
  taste_profile_history    TEXT DEFAULT '[]',
  content_warning_blacklist TEXT DEFAULT '[]',
  work_blacklist           TEXT DEFAULT '[]',
  author_kudos_list        TEXT DEFAULT '[]',
  updated_at               TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analysis_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  work_id     TEXT NOT NULL,
  result      TEXT NOT NULL,
  is_complete INTEGER DEFAULT 0,
  cached_at   TEXT DEFAULT (datetime('now')),
  expires_at  TEXT,
  UNIQUE(user_id, work_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  date         TEXT NOT NULL,
  fics         TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS reading_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  work_id     TEXT NOT NULL,
  title       TEXT,
  ao3_url     TEXT,
  added_at    TEXT DEFAULT (datetime('now')),
  cached_score REAL,
  UNIQUE(user_id, work_id)
);

CREATE TABLE IF NOT EXISTS journal (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  work_id      TEXT NOT NULL,
  title        TEXT,
  fandom       TEXT,
  ship         TEXT,
  word_count   INTEGER,
  overall_score REAL,
  comment_text TEXT,
  comment_type TEXT CHECK(comment_type IN ('tool_private', 'ao3_public')),
  read_result  TEXT CHECK(read_result IN ('completed', 'dropped', 'ongoing')),
  ao3_url      TEXT,
  used_in_calibration INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  work_id     TEXT NOT NULL,
  ai_score    REAL,
  user_rating TEXT CHECK(user_rating IN ('accurate', 'inaccurate')),
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stats (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id),
  total_cny       REAL DEFAULT 0,
  analyses_total  INTEGER DEFAULT 0,
  analyses_cached INTEGER DEFAULT 0,
  by_model        TEXT DEFAULT '{}',
  signals_total   INTEGER DEFAULT 0,
  last_calibrated TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cache_user_work ON analysis_cache(user_id, work_id);
CREATE INDEX IF NOT EXISTS idx_rec_user_date ON recommendations(user_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal(user_id, created_at DESC);
