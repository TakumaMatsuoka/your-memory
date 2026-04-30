const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your-memory-local-secret";

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set with 32+ chars in production.");
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "ログインが必要です。" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "認証トークンが無効です。" });
  }
}

module.exports = { signToken, authMiddleware };
