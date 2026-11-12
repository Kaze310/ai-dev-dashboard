import { NextRequest, NextResponse } from "next/server";
import { callbackUrl, sessionCookieOptions, cookieOptions, finishLogin, FLOW_COOKIE, getCognitoConfig, readFlow, sealSession, SESSION_COOKIE } from "@/lib/auth/cognito";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getCognitoConfig();
  const destination = new URL("/", config.origin);
  let sessionCookie: string | undefined;
  let maxAge = 0;
  try {
    const flow = await readFlow(config, request.cookies.get(FLOW_COOKIE)?.value);
    if (!flow) throw new Error("Missing or expired login flow");
    // Trust the configured public origin, not a forwarded Host header.
    const url = new URL(callbackUrl(config));
    url.search = request.nextUrl.search;
    const session = await finishLogin(config, url, flow);
    sessionCookie = await sealSession(config, session);
    maxAge = Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000));
  } catch {
    // Provider errors may contain sensitive details; expose only a fixed message.
    destination.pathname = "/login";
    destination.searchParams.set("error", "login_failed");
  }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(FLOW_COOKIE, "", cookieOptions(config, 0));
  if (sessionCookie) response.cookies.set(SESSION_COOKIE, sessionCookie, sessionCookieOptions(config, maxAge));
  return response;
}
