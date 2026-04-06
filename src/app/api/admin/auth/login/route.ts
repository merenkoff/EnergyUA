import { NextResponse } from "next/server";
import {
  cookieName,
  getAdminRouteSecret,
  isAdminConfigured,
  signAdminSession,
  verifyAdminPassword,
} from "@/lib/adminAuth";

export async function POST(req: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Адмінка не налаштована (змінні оточення)" }, { status: 503 });
  }
  let body: { password?: string; routeSecret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }
  const routeSecret = body.routeSecret?.trim() ?? "";
  if (!routeSecret || routeSecret !== getAdminRouteSecret()) {
    return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
  }
  if (!verifyAdminPassword(body.password ?? "")) {
    return NextResponse.json({ error: "Невірний пароль" }, { status: 401 });
  }

  const token = signAdminSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/ops/${routeSecret}`,
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
