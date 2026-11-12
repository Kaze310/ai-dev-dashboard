import { NextResponse } from "next/server";
import { getCognitoConfig } from "@/lib/auth/cognito";

// Old Supabase email links must not create an alternate application session.
export async function GET() {
  return NextResponse.redirect(new URL("/login", getCognitoConfig().origin), 303);
}
