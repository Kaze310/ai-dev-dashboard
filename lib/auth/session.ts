import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCognitoConfig, readSession, SESSION_COOKIE } from "./cognito";
import { AccountNotProvisionedError } from "@/lib/db/transaction";

export async function getAppSession() {
  // Enter request-time rendering before reading runtime-only credentials.
  // A standalone image build must not need Cognito secrets for prerendering.
  const cookieStore = await cookies();
  return readSession(getCognitoConfig(), cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requirePageSession() {
  const user = await getAppSession();
  if (!user) redirect("/login");
  return user;
}

export async function authorizeApi(request?: Request) {
  const user = await getAppSession();
  if (!user) return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (request && !["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== getCognitoConfig().origin) {
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, response: null };
}

export function apiFailure(error: unknown) {
  const unprovisioned = error instanceof AccountNotProvisionedError;
  return NextResponse.json({ error: unprovisioned ? error.message : "Unable to complete the database operation. Please try again." }, { status: unprovisioned ? 403 : 500 });
}
