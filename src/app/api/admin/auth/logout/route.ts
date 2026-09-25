import { NextResponse } from "next/server";
import { cookieName, getAdminRouteSecret } from "@/lib/adminAuth";

export async function POST(req: Request) {
  let routeSecret = "";
  try {
    const j = await req.json();
    routeSecret = typeof j.routeSecret === "string" ? j.routeSecret.trim() : "";
  } catch {
    routeSecret = getAdminRouteSecret();
  }
  const res = NextResponse.json({ ok: true });
  // Cookie ставиться з path "/"; старий cookie з path /ops/<secret> (до виправлення) прибираємо теж.
  // Два Set-Cookie з одним іменем — лише через headers.append: res.cookies.set перезаписує попередній.
  res.headers.append("Set-Cookie", `${cookieName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=lax`);
  if (routeSecret) {
    res.headers.append("Set-Cookie", `${cookieName()}=; Path=/ops/${routeSecret}; Max-Age=0; HttpOnly; SameSite=lax`);
  }
  return res;
}
