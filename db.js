const { Pool } = require("pg");
require("dotenv").config();

// Подключение к Supabase через строку соединения (Connection String)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Обязательно для безопасного подключения к облаку Supabase
  },
});

// Объект-обертка, имитирующий методы sqlite3 (чтобы не переписывать index.js!)
const db = {
  run: (query, params = [], callback) => {
    // Переводим синтаксис SQLite (?) в синтаксис PostgreSQL ($1, $2)
    let index = 1;
    const pgQuery = query.replace(/\?/g, () => `$${index++}`);

    pool.query(pgQuery, params)
      .then((res) => {
        if (callback) callback(null, res);
      })
      .catch((err) => {
        console.error("❌ Ошибка выполнения запроса в БД:", err.message);
        if (callback) callback(err);
      });
  },
  
  get: (query, params = [], callback) => {
    let index = 1;
    const pgQuery = query.replace(/\?/g, () => `$${index++}`);

    pool.query(pgQuery, params)
      .then((res) => {
        if (callback) callback(null, res.rows[0] || null);
      })
      .catch((err) => {
        console.error("❌ Ошибка при получении строки из БД:", err.message);
        if (callback) callback(err);
      });
  },

  all: (query, params = [], callback) => {
    let index = 1;
    const pgQuery = query.replace(/\?/g, () => `$${index++}`);

    pool.query(pgQuery, params)
      .then((res) => {
        if (callback) callback(null, res.rows || []);
      })
      .catch((err) => {
        console.error("❌ Ошибка при получении массива строк из БД:", err.message);
        if (callback) callback(err);
      });
  },
  
  close: (callback) => {
    pool.end()
      .then(() => {
        if (callback) callback(null);
      })
      .catch((err) => {
        if (callback) callback(err);
      });
  }
};

// Инициализация таблиц в PostgreSQL
const initDb = async () => {
  try {
    // Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        chat_id TEXT PRIMARY KEY,
        category TEXT
      )
    `);

    // Таблица сообщений (истории)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id TEXT,
        role TEXT,
        content TEXT
      )
    `);
    console.log("🔹 База данных Supabase (PostgreSQL) успешно инициализирована.");
  } catch (err) {
    console.error("❌ Критическая ошибка инициализации таблиц Supabase:", err.message);
  }
};

initDb();

module.exports = db;