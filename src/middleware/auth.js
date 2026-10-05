import jwt from "jsonwebtoken";

export function signSession(userId) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }

  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function setSessionCookie(res, token) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };

  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  res.cookie("wacrm_session", token, cookieOptions);
}

export function clearSessionCookie(res) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };

  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  res.clearCookie("wacrm_session", cookieOptions);
}

export function requireAuth(req, res, next) {
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const suppliedInternalSecret = req.get("x-internal-api-secret");

  if (
    internalSecret &&
    suppliedInternalSecret &&
    suppliedInternalSecret === internalSecret
  ) {
    req.isInternal = true;
    return next();
  }

  const token = req.cookies?.wacrm_session;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
