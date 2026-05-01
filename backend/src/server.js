require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { z } = require("zod");
const db = require("./db");
const { authMiddleware, signToken } = require("./auth");

const app = express();
const port = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

// Railway 等のリバースプロキシでは X-Forwarded-For が付く。未設定だと express-rate-limit が ValidationError を投げる。
// 環境変数に依存させると本番で効かないケースがあるため、API サーバーでは常に 1-hop のプロキシを信頼する。
app.set("trust proxy", 1);

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
  validate: false,
});

const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "試行回数が多すぎます。しばらくしてから再試行してください。" },
  validate: false,
});

app.use("/auth", authLimiter);
app.use(apiLimiter);

const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const accountUpdateSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const accountEmailSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const accountDeleteSchema = z.object({
  password: z.string().min(8),
});

const pendingRegisterMap = new Map();
const registerCodeTtlMs = 10 * 60 * 1000;

function buildMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendVerificationEmail(email, code) {
  const transporter = buildMailer();
  if (!transporter) {
    console.log(`[register-code] ${email}: ${code}`);
    return false;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Your Memory 認証コード",
    text: `認証コード: ${code}\n有効期限は10分です。`,
  });
  return true;
}

function generateUniqueUsername(email) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "") || "user";
  let candidate = base.slice(0, 24);
  let suffix = 0;
  while (true) {
    const username = suffix === 0 ? candidate : `${candidate}${suffix}`;
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (!existing) return username;
    suffix += 1;
  }
}

const memorySchema = z.object({
  trackId: z.number().int().min(1).max(10).optional().default(1),
  title: z.string().min(1).max(120),
  photoUrl: z.string().max(2000).optional().or(z.literal("")),
  content: z.string().min(1).max(5000),
  people: z.string().max(300).optional().or(z.literal("")),
  labels: z.array(z.string().min(1).max(40)).max(20),
  important: z.boolean().optional().default(false),
  memoryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/register/request-code", async (req, res) => {
  const parsed = registerRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const { email, password } = parsed.data;
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ message: "そのメールアドレスは既に使用されています。" });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  pendingRegisterMap.set(email.toLowerCase(), {
    passwordHash: bcrypt.hashSync(password, 10),
    code,
    expiresAt: Date.now() + registerCodeTtlMs,
  });
  try {
    const sent = await sendVerificationEmail(email.toLowerCase(), code);
    const body = { ok: true, message: "認証コードを送信しました。" };
    if (!sent && !isProd) {
      body.debugCode = code;
    }
    return res.json(body);
  } catch (_e) {
    return res.status(500).json({ message: "認証コードの送信に失敗しました。" });
  }
});

app.post("/auth/register/verify-code", (req, res) => {
  const parsed = registerVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const { email, code } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const pending = pendingRegisterMap.get(normalizedEmail);
  if (!pending || pending.expiresAt < Date.now() || pending.code !== code) {
    return res.status(400).json({ message: "認証コードが不正、または期限切れです。" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    pendingRegisterMap.delete(normalizedEmail);
    return res.status(409).json({ message: "そのメールアドレスは既に使用されています。" });
  }
  const birthDate = new Date().toISOString().slice(0, 10);
  const username = generateUniqueUsername(normalizedEmail);
  const result = db
    .prepare("INSERT INTO users (username, email, birth_date, password_hash) VALUES (?, ?, ?, ?)")
    .run(username, normalizedEmail, birthDate, pending.passwordHash);
  pendingRegisterMap.delete(normalizedEmail);
  const user = { id: result.lastInsertRowid, username, email: normalizedEmail, birthDate };
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
    .prepare("SELECT id, username, email, birth_date, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: "メールアドレスまたはパスワードが違います。" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, birthDate: user.birth_date },
  });
});

app.get("/memories", authMiddleware, (req, res) => {
  const view = req.query.view || "month";
  const q = (req.query.q || "").toString().trim().toLowerCase();
  const label = (req.query.label || "").toString().trim().toLowerCase();
  const user = db
    .prepare("SELECT username, birth_date FROM users WHERE id = ?")
    .get(req.user.id);
  const birthDate = user?.birth_date || null;

  let rows = db
    .prepare(
      `SELECT id, title, photo_url, content, people, labels, important, memory_date
       , track_id
       FROM memories
       WHERE user_id = ?
       ORDER BY memory_date ASC, id ASC`
    )
    .all(req.user.id);

  rows = rows.map((row) => ({
    id: row.id,
    trackId: row.track_id || 1,
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

  return res.json({ memories: rows, user: { birthDate, username: user?.username || null } });
});

app.get("/account", authMiddleware, (req, res) => {
  const user = db
    .prepare("SELECT id, username, email, birth_date FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user) {
    return res.status(404).json({ message: "アカウントが見つかりません。" });
  }
  return res.json({
    user: { id: user.id, username: user.username, email: user.email, birthDate: user.birth_date || "" },
  });
});

app.put("/account", authMiddleware, (req, res) => {
  const parsed = accountUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const { username, birthDate } = parsed.data;
  const duplicate = db
    .prepare("SELECT id FROM users WHERE username = ? AND id <> ?")
    .get(username.toLowerCase(), req.user.id);
  if (duplicate) {
    return res.status(409).json({ message: "そのログイン名は既に使用されています。" });
  }
  db.prepare("UPDATE users SET username = ?, birth_date = ? WHERE id = ?").run(
    username.toLowerCase(),
    birthDate,
    req.user.id
  );
  return res.json({ ok: true });
});

app.put("/account/email", authMiddleware, (req, res) => {
  const parsed = accountEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const { email, password } = parsed.data;
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: "パスワードが違います。" });
  }
  const duplicate = db
    .prepare("SELECT id FROM users WHERE email = ? AND id <> ?")
    .get(email.toLowerCase(), req.user.id);
  if (duplicate) {
    return res.status(409).json({ message: "そのメールアドレスは既に使用されています。" });
  }
  db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email.toLowerCase(), req.user.id);
  return res.json({ ok: true, email: email.toLowerCase() });
});

app.delete("/account", authMiddleware, (req, res) => {
  const parsed = accountDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
    return res.status(401).json({ message: "パスワードが違います。" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
  return res.json({ ok: true });
});

app.post("/memories", authMiddleware, (req, res) => {
  const parsed = memorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }

  const { trackId, title, photoUrl, content, people, labels, important, memoryDate } = parsed.data;

  const result = db
    .prepare(
      `INSERT INTO memories (user_id, track_id, title, photo_url, content, people, labels, important, memory_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      trackId,
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

  const { trackId, title, photoUrl, content, people, labels, important, memoryDate } = parsed.data;
  db.prepare(
    `UPDATE memories
     SET track_id = ?, title = ?, photo_url = ?, content = ?, people = ?, labels = ?, important = ?, memory_date = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    trackId,
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
