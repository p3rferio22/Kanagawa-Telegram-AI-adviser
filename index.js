const db = require("./db");
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const prompts = require("./prompts");

// --- ФЕЙКОВИЙ СЕРВЕР ДЛЯ RENDER (Щоб сервіс не падав по таймауту) ---
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`🤖 Фейковий сервер запустищено на порту ${PORT}`);
});
// ------------------------------------------------------------------

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Об'єкт для відстеження стану генерації (захист від спаму запитами)
const userProcessing = new Set();

// ------------------ INLINE MENU ------------------

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "💻 Фронтенд", callback_data: "Фронтенд" },
        { text: "⚙️ Бекенд", callback_data: "Бекенд" },
      ],
      [
        { text: "🔐 Кібербезпека", callback_data: "Кібербезпека" },
        { text: "🐳 DevOps", callback_data: "DevOps" },
      ],
      [
        { text: "🧠 ШІ", callback_data: "ШІ" },
        { text: "📝 Код", callback_data: "Перевірка коду" },
      ],
      [
        { text: "🗑 Новий чат", callback_data: "newchat" },
        { text: "🔧 Admin", callback_data: "admin_menu" },
      ],
    ],
  },
};

// ------------------ ADMIN MENU ------------------

const adminMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "👥 Користувачі", callback_data: "admin_users" },
        { text: "📊 Статистика", callback_data: "admin_stats" },
      ],
      [
        { text: "📜 Історія дій", callback_data: "admin_history_users_list" },
      ],
      [
        { text: "🧹 Очистити БД чатів", callback_data: "admin_clear" },
      ],
      [
        { text: "⬅️ Назад", callback_data: "back_main" },
      ],
    ],
  },
};

// ------------------ CATEGORIES ------------------

const categories = {
  "Фронтенд": "frontend",
  "Бекенд": "backend",
  "Кібербезпека": "cybersecurity",
  "DevOps": "devops",
  "ШІ": "ai",
  "Перевірка коду": "code",
};

// ------------------ ADMIN ------------------

function isAdmin(chatId) {
  if (!process.env.ADMIN_ID) return false;
  
  // Розбиваємо рядок з .env через кому в масив і прибираємо випадкові пробіли навколо ID
  const adminIds = process.env.ADMIN_ID.split(',').map(id => id.trim());
  
  // Перевіряємо, чи є поточний chatId серед дозволених адмінів
  return adminIds.includes(String(chatId));
}

// НАДІЙНИЙ ПОМІЧНИК: Безпечне розбиття довгих текстів з урахуванням HTML-тегів та код-блоків (```)
async function sendLongMessage(chatId, text, options = {}) {
  const MAX_LENGTH = 4000; // Ліміт з невеликим запасом на відкриті HTML-теги
  let offset = 0;
  
  while (offset < text.length) {
    let part = text.substring(offset, offset + MAX_LENGTH);
    
    // Перевірка 1: Захист від розриву HTML-тегу <b>
    if (part.includes("<b>") && !part.includes("</b>")) {
      const lastOpenTag = part.lastIndexOf("<b>");
      if (lastOpenTag > 0) {
        part = text.substring(offset, offset + lastOpenTag);
      }
    }
    
    // Перевірка 2: Захист від розриву код-блоків markdown (```)
    const codeBlocksCount = (part.match(/```/g) || []).length;
    if (codeBlocksCount % 2 !== 0) {
      const lastCodeBlock = part.lastIndexOf("```");
      if (lastCodeBlock > 0) {
        part = text.substring(offset, offset + lastCodeBlock);
      }
    }
    
    // Перевірка 3: Намагаємося різати по логічних переносах або пробілах, щоб не рвати слова
    if (offset + part.length < text.length) {
      const lastNewline = part.lastIndexOf("\n");
      const lastSpace = part.lastIndexOf(" ");
      
      if (lastNewline > MAX_LENGTH * 0.7) {
        part = part.substring(0, lastNewline + 1);
      } else if (lastSpace > MAX_LENGTH * 0.7) {
        part = part.substring(0, lastSpace + 1);
      }
    }
    
    // Послідовне відправлення шматка тексту
    await bot.sendMessage(chatId, part, options);
    offset += part.length;
  }
}

// NОВА ФУНКЦІЯ: Отримання та надсилання випадкової гіфки з відповідей котів (Giphy API Rating G)
async function sendRandomCatGif(chatId) {
  try {
    const response = await axios.get("https://api.giphy.com/v1/gifs/random", {
      params: {
        api_key: process.env.GIPHY_API_KEY,
        tag: "cat meme",
        rating: "g" 
      }
    });

    const gifUrl = response.data?.data?.images?.original?.url;
    
    if (gifUrl) {
      await bot.sendAnimation(chatId, gifUrl, { caption: "🐾 Лови котика для гарного настрою!" });
    }
  } catch (error) {
    console.error("❌ Помилка отримання гіфки з Giphy:", error.message);
    try {
      const backupUrl = `https://cataas.com/cat/gif?timestamp=${Date.now()}`;
      await bot.sendAnimation(chatId, backupUrl, { caption: "🐾 Резервний котик!" });
    } catch (e) {
      console.error("❌ Резервне API котиків також недоступне");
    }
  }
}

// ------------------ DB ------------------

function setCategory(chatId, category) {
  db.run(
    `INSERT INTO users(chat_id, category)
     VALUES(?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET category = ?`,
    [chatId, category, category]
  );
}

function getCategory(chatId) {
  return new Promise((resolve) => {
    db.get(
      `SELECT category FROM users WHERE chat_id = ?`,
      [chatId],
      (err, row) => resolve(row ? row.category : null)
    );
  });
}

function saveMessage(chatId, role, content) {
  db.run(
    `INSERT INTO messages(chat_id, role, content)
     VALUES(?, ?, ?)`,
    [chatId, role, content]
  );
}

function getHistory(chatId, limit = 10) {
  return new Promise((resolve) => {
    db.all(
      `SELECT role, content
       FROM messages
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [chatId, limit],
      (err, rows) => resolve(rows ? rows.reverse() : [])
    );
  });
}

// ------------------ TYPING ------------------

async function typing(chatId, time = 700) {
  await bot.sendChatAction(chatId, "typing");
  await new Promise((r) => setTimeout(r, time));
}

// ------------------ START ------------------

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Вітаю! Оберіть напрямок:", mainMenu);
});

bot.onText(/\/newchat/, (msg) => {
  db.run(`DELETE FROM messages WHERE chat_id = ?`, [msg.chat.id], () => {
    bot.sendMessage(msg.chat.id, "🗑 Діалог очищено.");
  });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`🤖 IT Консультант

/start - меню
/newchat - очистка`
  );
});

// ------------------ ADMIN COMMANDS ------------------

bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Немає доступу");

  bot.sendMessage(chatId, "🔧 Адмін-панель:", adminMenu);
});

bot.onText(/\/users/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  db.all(`SELECT DISTINCT chat_id FROM messages`, [], (err, rows) => {
    if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Користувачів немає");

    bot.sendMessage(
      chatId,
      "👥 Користувачі:\n\n" + rows.map(r => r.chat_id).join("\n")
    );
  });
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  db.get(
    `SELECT COUNT(DISTINCT chat_id) as users,
            COUNT(*) as messages
     FROM messages`,
    [],
    (err, row) => {
      bot.sendMessage(
        chatId,
`📊 Статистика

👥 Користувачі: ${row.users || 0}
💬 Повідомлення: ${row.messages || 0}`
      );
    }
  );
});

bot.onText(/\/user (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Немає доступу");

  const targetId = String(match[1]);

  db.all(
    `SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC`,
    [targetId],
    async (err, rows) => {
      if (err) return bot.sendMessage(chatId, "❌ Помилка БД");
      if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Історії немає");

      let history = "";
      rows.forEach(r => {
        const roleName = r.role === "user" ? "👤 КОРИСТУВАЧ" : "🤖 ШІ-БОТ";
        history += `<b>${roleName}:</b>\n${r.content}\n\n`;
      });

      await bot.sendMessage(chatId, `📜 <b>ІСТОРІЯ КОРИСТУВАЧА ${targetId}</b>`, { parse_mode: "HTML" });
      await sendLongMessage(chatId, history, { parse_mode: "HTML" });
    }
  );
});

// ------------------ CALLBACK OVERHAUL ------------------

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (categories[data]) {
    setCategory(chatId, categories[data]);
    return bot.sendMessage(
      chatId,
      `✅ Обрано: ${data}\nТепер напишіть питання.`
    );
  }

  if (data === "newchat") {
    db.run(`DELETE FROM messages WHERE chat_id = ?`, [chatId], () => {
      bot.sendMessage(chatId, "🗑 Діалог очищено.");
    });
    return;
  }

  if (data === "admin_menu") {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Немає доступу");
    return bot.sendMessage(chatId, "🔧 Адмін-панель:", adminMenu);
  }

  if (data === "admin_users") {
    if (!isAdmin(chatId)) return;

    db.all(`SELECT DISTINCT chat_id FROM messages`, [], (err, rows) => {
      if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Користувачів немає");
      bot.sendMessage(
        chatId,
        "👥 Користувачі:\n\n" + rows.map(r => r.chat_id).join("\n")
      );
    });
  }

  if (data === "admin_stats") {
    if (!isAdmin(chatId)) return;

    db.get(
      `SELECT COUNT(DISTINCT chat_id) as users,
              COUNT(*) as messages
       FROM messages`,
      [],
      (err, row) => {
        bot.sendMessage(
          chatId,
`📊 Статистика

👥 Користувачі: ${row.users || 0}
💬 Повідомлення: ${row.messages || 0}`
        );
      }
    );
  }

  if (data === "admin_history_users_list") {
    if (!isAdmin(chatId)) return;

    db.all(`SELECT DISTINCT chat_id FROM messages`, [], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return bot.sendMessage(chatId, "📭 База повідомлень порожня.");
      }

      const inline_keyboard = [];

      rows.forEach(row => {
        if (row.chat_id) {
          inline_keyboard.push([
            { text: `👤 Чат ID: ${row.chat_id}`, callback_data: `view_user_${row.chat_id}` }
          ]);
        }
      });
      
      inline_keyboard.push([
        { text: "⬅️ Назад", callback_data: "admin_menu" }
      ]);

      bot.sendMessage(chatId, "📜 Оберіть користувача з базы даних для перегляду історії:", {
        reply_markup: {
          inline_keyboard: inline_keyboard
        }
      });
    });
    return;
  }

  if (data.startsWith("view_user_")) {
    if (!isAdmin(chatId)) return;

    const targetId = String(data.replace("view_user_", ""));

    db.all(
      `SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC`,
      [targetId],
      async (err, rows) => {
        if (err) return bot.sendMessage(chatId, "❌ Помилка роботи з БД");
        if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Історії немає");

        let history = "";
        rows.forEach(r => {
          const roleName = r.role === "user" ? "👤 КОРИСТУВАЧ" : "🤖 ШІ-БОТ";
          history += `<b>${roleName}:</b>\n${r.content}\n\n`;
        });

        await bot.sendMessage(chatId, `📜 <b>ІСТОРІЯ ЧАТУ:</b> <code>${targetId}</code>`, { parse_mode: "HTML" });
        await sendLongMessage(chatId, history, { parse_mode: "HTML" });
      }
    );
    return;
  }

  if (data === "admin_clear") {
    if (!isAdmin(chatId)) return;

    db.run(`DELETE FROM messages`, [], () => {
      bot.sendMessage(chatId, "🧹 Базу повідомлень очищено");
    });
  }

  if (data === "back_main") {
    return bot.sendMessage(chatId, "🏠 Головне меню:", mainMenu);
  }
});

// ------------------ MAIN BOT LOGIC ------------------

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  if (userProcessing.has(chatId)) {
    return bot.sendMessage(chatId, "⏳ Будь ласка, зачекайте, я ще формую відповідь на попереднє питання.");
  }

  const category = await getCategory(chatId);

  if (!category) {
    return bot.sendMessage(chatId, "⚠️ Оберіть категорію через /start");
  }

  try {
    userProcessing.add(chatId);

    await typing(chatId, 700);

    saveMessage(chatId, "user", text);

    const historyRaw = await getHistory(chatId, 10);
    const history = historyRaw.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const systemPrompt = `${prompts[category]}\n\n⚠️ ВАЖЛИВО: Категорично заборонено генерувати старі шаблони та лінії на кшталт "━━━━". Оформлюй структуру самостійно. Всі свої заголовки виділяй за допомогою HTML-тегів <b>Текст</b>.`;

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...history,
        ],
        temperature: 0.6,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const answer = response.data.choices[0].message.content;

    saveMessage(chatId, "assistant", answer);
    
    // 1. Надсилання великих відповідей від ШІ
    await sendLongMessage(chatId, answer, { parse_mode: "HTML" });

    // 2. АВТОМАТИЧНЕ НАДСИЛАННЯ ГІФКИ ПІСЛЯ ВІДПОВІДІ ШІ
    await sendRandomCatGif(chatId);

  } catch (e) {
    console.error("❌ Помилка AI API:", e.response ? e.response.data : e.message);
    bot.sendMessage(chatId, "❌ Сталася помилка під час запиту до ШІ. Спробуйте пізніше.");
  } finally {
    userProcessing.add(chatId); // Захист
    userProcessing.delete(chatId);
  }
});

// БЕЗПЕЧНЕ ВИМКНЕННЯ (GRACEFUL SHUTDOWN)
const gracefulShutdown = () => {
  console.log("\n🛑 Отримано сигнал зупинки. Закриття ресурсів...");
  bot.stopPolling();
  db.close((err) => {
    if (err) console.error("Помилка закриття БД:", err.message);
    else console.log("📦 З'єднання з базою даних закрито.");
    process.exit(0);
  });
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log("🤖 Bot running successfully...");