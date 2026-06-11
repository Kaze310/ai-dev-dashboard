import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * 只允许站内相对路径,防止 open redirect:
 * `?next=https://evil.com` 或 `?next=//evil.com` 此前都能跳出本站。
 */
function sanitizeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }

  return next;
}

export async function GET(request: NextRequest) {
  // 用户点击邮件确认链接后会回到这里,URL 中通常包含 code 参数。
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    // 用 code 向 Supabase 交换成真正的登录会话。
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url));
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
