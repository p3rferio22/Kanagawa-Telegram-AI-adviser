const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./bot.db");

// таблица пользователей
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    category TEXT
  )
`);

// таблица истории сообщений
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    role TEXT,
    content TEXT
  )
`);

module.exports = db;