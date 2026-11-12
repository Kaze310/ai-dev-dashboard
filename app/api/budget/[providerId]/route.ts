import { NextResponse } from "next/server";
import { parseMonthlyLimitField, parseThresholdField } from "@/lib/budget-validation";
import { authorizeApi, apiFailure } from "@/lib/auth/session";
import { withUserDatabase } from "@/lib/db/pool";
import { isUserId } from "@/lib/db/transaction";

export async function PUT(request: Request, context: { params: Promise<{ providerId: string }> }) {
  const { user, response } = await authorizeApi(request);
  if (!user) return response;
  const { providerId } = await context.params;
  if (!isUserId(providerId)) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  const limit = parseMonthlyLimitField(body);
  const threshold = parseThresholdField(body);
  if (limit.kind === "invalid" || threshold.kind === "invalid") {
    return NextResponse.json({ error: "Use a positive monthly_limit_cents (or null to clear) and alert_threshold_pct between 1 and 100" }, { status: 400 });
  }
  if (limit.kind === "missing" && threshold.kind === "missing") {
    return NextResponse.json({ error: "Nothing to update: provide monthly_limit_cents and/or alert_threshold_pct" }, { status: 400 });
  }
  try {
    const provider = await withUserDatabase(user.sub, async (db) => (await db.query(`
      UPDATE public.providers SET
      monthly_limit_cents = CASE WHEN $3 THEN $4::integer ELSE monthly_limit_cents END,
      alert_threshold_pct = CASE WHEN $5 THEN $6::integer ELSE alert_threshold_pct END
      WHERE id = $1 AND user_id = $2 RETURNING id, name, monthly_limit_cents, alert_threshold_pct`,
      [providerId, user.sub, limit.kind !== "missing", limit.kind === "value" ? limit.cents : null,
        threshold.kind === "value", threshold.kind === "value" ? threshold.pct : null])).rows[0]);
    return provider ? NextResponse.json({ saved: true, provider }) : NextResponse.json({ error: "Provider not found" }, { status: 404 });
  } catch (error) { return apiFailure(error); }
}
