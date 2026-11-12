import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, FLOW_COOKIE, FLOW_TTL, getCognitoConfig, isSameOriginPost, sealFlow, startLogin } from "@/lib/auth/cognito";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const config = getCognitoConfig();
  if (!isSameOriginPost(request, config)) return new NextResponse("Forbidden", { status: 403 });
  const { url, flow } = await startLogin(config);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(FLOW_COOKIE, await sealFlow(config, flow), cookieOptions(config, FLOW_TTL));
  return response;
}
