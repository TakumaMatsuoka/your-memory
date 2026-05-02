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
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "試行回数が多すぎます。しばらくしてから再試行してください。" },
  validate: false,
});

app.use("/auth", authLimiter);
app.use(apiLimiter);

const usernamePasswordSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  recaptchaToken: z.string().optional(),
});

const loginIdentifierSchema = z.object({
  username: z.string().min(1).max(320),
  password: z.string().min(8),
  recaptchaToken: z.string().optional(),
});

const accountUpdateSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const accountDeleteSchema = z.object({
  password: z.string().min(8),
});

function internalPlaceholderEmail(usernameLower) {
  return `${usernameLower}@noreply.local`;
}

function isPlaceholderEmail(email) {
  return typeof email === "string" && email.endsWith("@noreply.local");
}

/** daily_metrics の day は UTC の YYYY-MM-DD */
function bumpDailyMetric(column) {
  const allowed = ["registrations", "login_ok", "login_fail"];
  if (!allowed.includes(column)) return;
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT 1 AS ok FROM daily_metrics WHERE day = ?").get(day);
  if (row) {
    db.prepare(`UPDATE daily_metrics SET ${column} = ${column} + 1 WHERE day = ?`).run(day);
  } else {
    const registrations = column === "registrations" ? 1 : 0;
    const loginOk = column === "login_ok" ? 1 : 0;
    const loginFail = column === "login_fail" ? 1 : 0;
    db.prepare(
      "INSERT INTO daily_metrics (day, registrations, login_ok, login_fail) VALUES (?,?,?,?)"
    ).run(day, registrations, loginOk, loginFail);
  }
}

async function verifyRecaptchaIfConfigured(token, remoteIp) {
  const secret = (process.env.RECAPTCHA_SECRET_KEY || "").trim();
  if (!secret) return true;
  if (!token || typeof token !== "string") {
    return false;
  }
  const minScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.3);
  const params = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) params.append("remoteip", remoteIp);
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.success) return false;
  if (data.score !== undefined && typeof data.score === "number" && data.score < minScore) {
    return false;
  }
  return true;
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

app.get("/public/metrics", (_req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const days = db
    .prepare(
      "SELECT day, registrations, login_ok, login_fail FROM daily_metrics ORDER BY day DESC LIMIT 30"
    )
    .all()
    .reverse();
  return res.json({ totalUsers, days });
});

app.post("/auth/register", async (req, res) => {
  const parsed = usernamePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const username = parsed.data.username.toLowerCase();
  const { password, recaptchaToken } = parsed.data;
  const remoteIp = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.socket.remoteAddress;
  try {
    const ok = await verifyRecaptchaIfConfigured(recaptchaToken || "", remoteIp);
    if (!ok) {
      return res.status(400).json({ message: "ボット対策の検証に失敗しました。しばらくしてから再試行してください。" });
    }
  } catch (e) {
    console.warn("[auth] recaptcha verify error:", e?.message || e);
    return res.status(503).json({ message: "認証検証サービスに接続できませんでした。" });
  }

  const dupUser = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (dupUser) {
    return res.status(409).json({ message: "そのログイン名は既に使用されています。" });
  }
  const placeholder = internalPlaceholderEmail(username);
  const dupEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(placeholder);
  if (dupEmail) {
    return res.status(409).json({ message: "そのログイン名は既に使用されています。" });
  }

  const birthDate = new Date().toISOString().slice(0, 10);
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare("INSERT INTO users (username, email, birth_date, password_hash) VALUES (?, ?, ?, ?)")
    .run(username, placeholder, birthDate, passwordHash);
  bumpDailyMetric("registrations");
  const user = {
    id: result.lastInsertRowid,
    username,
    birthDate,
  };
  const token = signToken(user);
  console.log(`[auth] register ok user_id=${user.id} username=${username}`);
  return res.status(201).json({ token, user: { ...user, email: null } });
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginIdentifierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const identifier = parsed.data.username.trim().toLowerCase();
  const { password, recaptchaToken } = parsed.data;
  const remoteIp = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.socket.remoteAddress;
  try {
    const ok = await verifyRecaptchaIfConfigured(recaptchaToken || "", remoteIp);
    if (!ok) {
      return res.status(400).json({ message: "ボット対策の検証に失敗しました。しばらくしてから再試行してください。" });
    }
  } catch (e) {
    console.warn("[auth] recaptcha verify error:", e?.message || e);
    return res.status(503).json({ message: "認証検証サービスに接続できませんでした。" });
  }

  const user = db
    .prepare(
      `SELECT id, username, email, birth_date, password_hash FROM users
       WHERE lower(username) = ? OR lower(email) = ?`
    )
    .get(identifier, identifier);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    bumpDailyMetric("login_fail");
    console.warn("[auth] login_fail", { identifier: identifier.slice(0, 64) });
    return res.status(401).json({ message: "ログイン名またはパスワードが違います。" });
  }

  bumpDailyMetric("login_ok");
  const token = signToken(user);
  console.log(`[auth] login_ok user_id=${user.id}`);
  const emailOut = isPlaceholderEmail(user.email) ? null : user.email;
  return res.json({
    token,
    user: { id: user.id, username: user.username, email: emailOut, birthDate: user.birth_date },
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
  const emailOut = isPlaceholderEmail(user.email) ? null : user.email;
  return res.json({
    user: { id: user.id, username: user.username, email: emailOut, birthDate: user.birth_date || "" },
  });
});

app.put("/account", authMiddleware, (req, res) => {
  const parsed = accountUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "入力内容が不正です。" });
  }
  const { username, birthDate } = parsed.data;
  const usernameLower = username.toLowerCase();
  const duplicate = db
    .prepare("SELECT id FROM users WHERE username = ? AND id <> ?")
    .get(usernameLower, req.user.id);
  if (duplicate) {
    return res.status(409).json({ message: "そのログイン名は既に使用されています。" });
  }
  const row = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
  const nextEmail = isPlaceholderEmail(row?.email)
    ? internalPlaceholderEmail(usernameLower)
    : row?.email;
  if (isPlaceholderEmail(row?.email)) {
    const dupPh = db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(nextEmail, req.user.id);
    if (dupPh) {
      return res.status(409).json({ message: "そのログイン名は既に使用されています。" });
    }
  }
  db.prepare("UPDATE users SET username = ?, birth_date = ?, email = ? WHERE id = ?").run(
    usernameLower,
    birthDate,
    nextEmail,
    req.user.id
  );
  return res.json({ ok: true });
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
  if (isProd) {
    console.warn(
      "[beta] テスト公開モード想定: メール認証なし。RECAPTCHA_SECRET_KEY / VITE_RECAPTCHA_SITE_KEY 推奨。集計は GET /public/metrics"
    );
  }
});
