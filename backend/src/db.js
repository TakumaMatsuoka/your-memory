const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "your-memory.db");
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  birth_date TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  photo_url TEXT,
  content TEXT NOT NULL,
  people TEXT,
  labels TEXT,
  important INTEGER NOT NULL DEFAULT 0,
  memory_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_user_date ON memories(user_id, memory_date);
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((col) => col.name === "birth_date")) {
  db.exec("ALTER TABLE users ADD COLUMN birth_date TEXT;");
}

const memoryColumns = db.prepare("PRAGMA table_info(memories)").all();
if (!memoryColumns.some((col) => col.name === "important")) {
  db.exec("ALTER TABLE memories ADD COLUMN important INTEGER NOT NULL DEFAULT 0;");
}

module.exports = db;
