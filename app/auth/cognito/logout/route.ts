import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, sessionCookieOptions, FLOW_COOKIE, getCognitoConfig, isSameOriginPost, logoutUrl, SESSION_COOKIE } from "@/lib/auth/cognito";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const config = getCognitoConfig();
  if (!isSameOriginPost(request, config)) return new NextResponse("Forbidden", { status: 403 });
  const response = NextResponse.redirect(logoutUrl(config), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(config, 0));
  response.cookies.set(FLOW_COOKIE, "", cookieOptions(config, 0));
  return response;
}
