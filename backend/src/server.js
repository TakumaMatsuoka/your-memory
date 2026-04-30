require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const db = require("./db");
const { authMiddleware, signToken } = require("./auth");

const app = express();
const port = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (!isProd) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin denied"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "8mb" }));

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "試行回数が多すぎます。しばらくしてから再試行してください。" },
});

app.use("/auth", authLimiter);
app.use(apiLimiter);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const memorySchema = z.object({
  title: z.string().min(1).max(120),
  photoUrl: z.string().url().optional().or(z.literal("")),
  content: z.string().min(1).max(5000),
  people: z.string().max(300).optional().or(z.literal("")),
  labels: z.array(z.string().min(1).max(40)).max(20),
  important: z.boolean().optional().default(false),
  memoryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }

  const { email, password, birthDate } = parsed.data;
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ message: "そのメールアドレスは既に使用されています。" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare("INSERT INTO users (email, birth_date, password_hash) VALUES (?, ?, ?)")
    .run(email.toLowerCase(), birthDate, passwordHash);

  const user = { id: result.lastInsertRowid, email: email.toLowerCase(), birthDate };
  const token = signToken(user);
  return res.status(201).json({ token, user });
});

app.post("/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }

  const { email, password } = parsed.data;
  const user = db
    .prepare("SELECT id, email, birth_date, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: "メールアドレスまたはパスワードが違います。" });
  }

  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email, birthDate: user.birth_date } });
});

app.get("/memories", authMiddleware, (req, res) => {
  const view = req.query.view || "month";
  const q = (req.query.q || "").toString().trim().toLowerCase();
  const label = (req.query.label || "").toString().trim().toLowerCase();
  const user = db
    .prepare("SELECT birth_date FROM users WHERE id = ?")
    .get(req.user.id);
  const birthDate = user?.birth_date || null;

  let rows = db
    .prepare(
      `SELECT id, title, photo_url, content, people, labels, important, memory_date
       FROM memories
       WHERE user_id = ?
       ORDER BY memory_date ASC, id ASC`
    )
    .all(req.user.id);

  rows = rows.map((row) => ({
    id: row.id,
    title: row.title,
    photoUrl: row.photo_url,
    content: row.content,
    people: row.people || "",
    labels: row.labels ? JSON.parse(row.labels) : [],
    important: row.important === 1,
    memoryDate: row.memory_date,
    ageAtMemory: birthDate ? calculateAge(birthDate, row.memory_date) : null,
    viewBucket: toBucket(row.memory_date, view),
  }));

  if (q) {
    rows = rows.filter((row) => {
      const haystack = `${row.title} ${row.content} ${row.people}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  if (label) {
    rows = rows.filter((row) =>
      row.labels.map((v) => v.toLowerCase()).includes(label)
    );
  }

  return res.json({ memories: rows, user: { birthDate } });
});

app.post("/memories", authMiddleware, (req, res) => {
  const parsed = memorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }

  const { title, photoUrl, content, people, labels, important, memoryDate } = parsed.data;

  const result = db
    .prepare(
      `INSERT INTO memories (user_id, title, photo_url, content, people, labels, important, memory_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      title.trim(),
      photoUrl || null,
      content.trim(),
      people?.trim() || "",
      JSON.stringify(labels.map((v) => v.trim()).filter(Boolean)),
      important ? 1 : 0,
      memoryDate
    );

  return res.status(201).json({ id: result.lastInsertRowid });
});

app.put("/memories/:id", authMiddleware, (req, res) => {
  const memoryId = Number(req.params.id);
  if (!Number.isInteger(memoryId) || memoryId <= 0) {
    return res.status(400).json({ message: "IDが不正です。" });
  }

  const parsed = memorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }

  const existing = db
    .prepare("SELECT id FROM memories WHERE id = ? AND user_id = ?")
    .get(memoryId, req.user.id);
  if (!existing) {
    return res.status(404).json({ message: "思い出が見つかりません。" });
  }

  const { title, photoUrl, content, people, labels, important, memoryDate } = parsed.data;
  db.prepare(
    `UPDATE memories
     SET title = ?, photo_url = ?, content = ?, people = ?, labels = ?, important = ?, memory_date = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    title.trim(),
    photoUrl || null,
    content.trim(),
    people?.trim() || "",
    JSON.stringify(labels.map((v) => v.trim()).filter(Boolean)),
    important ? 1 : 0,
    memoryDate,
    memoryId,
    req.user.id
  );

  return res.json({ ok: true });
});

function toBucket(dateText, view) {
  const d = new Date(`${dateText}T00:00:00`);
  if (view === "year") {
    return `${d.getFullYear()}`;
  }
  if (view === "week") {
    const week = getWeekNumber(d);
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getWeekNumber(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
}

function calculateAge(birthDateText, eventDateText) {
  const birth = new Date(`${birthDateText}T00:00:00`);
  const event = new Date(`${eventDateText}T00:00:00`);
  let age = event.getFullYear() - birth.getFullYear();
  const m = event.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && event.getDate() < birth.getDate())) {
    age -= 1;
  }
  return Math.max(age, 0);
}

app.listen(port, () => {
  console.log(`Your Memory API listening on http://localhost:${port}`);
});
