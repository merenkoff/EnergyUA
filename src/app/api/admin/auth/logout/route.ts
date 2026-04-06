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
  const path = routeSecret ? `/ops/${routeSecret}` : "/";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), "", { httpOnly: true, path, maxAge: 0 });
  return res;
}
