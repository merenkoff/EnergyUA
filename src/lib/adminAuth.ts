import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "eh_admin_sess";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionKey(): string {
  const k = process.env.ADMIN_SESSION_SECRET?.trim() || process.env.ADMIN_PASSWORD?.trim();
  return k ?? "";
}

/** Сегмент URL після /ops/ — має збігатися з ADMIN_ROUTE_SECRET (у dev за замовчуванням "dev"). */
export function getAdminRouteSecret(): string {
  const s = process.env.ADMIN_ROUTE_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === "development") return "dev";
  return "";
}

export function isAdminConfigured(): boolean {
  return Boolean(sessionKey() && getAdminRouteSecret());
}

export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected || !password) return false;
  try {
    return timingSafeEqual(Buffer.from(password, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

export function signAdminSession(): string {
  const key = sessionKey();
  if (!key) throw new Error("ADMIN_PASSWORD or ADMIN_SESSION_SECRET not set");
  const exp = Date.now() + TTL_MS;
  const payload = String(exp);
  const sig = createHmac("sha256", key).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const key = sessionKey();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = parseInt(payload, 10);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function getAdminSessionCookie(): Promise<string | undefined> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value;
}

export function cookieName(): typeof COOKIE_NAME {
  return COOKIE_NAME;
}

export async function requireAdminSession(routeSecret: string): Promise<void> {
  if (routeSecret !== getAdminRouteSecret()) redirect("/");
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    redirect(`/ops/${routeSecret}/login`);
  }
}
