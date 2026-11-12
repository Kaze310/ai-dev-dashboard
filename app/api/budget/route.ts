import { NextResponse } from "next/server";
import { getBudgetData } from "@/lib/budget-data";
import { DEFAULT_ALERT_THRESHOLD_PCT, parseMonthlyLimitField, parseThresholdField } from "@/lib/budget-validation";
import { authorizeApi, apiFailure } from "@/lib/auth/session";
import { withUserDatabase } from "@/lib/db/pool";

export async function GET() {
  const { user, response } = await authorizeApi();
  if (!user) return response;
  try { return NextResponse.json(await getBudgetData(user.sub)); }
  catch (error) { return apiFailure(error); }
}

export async function PUT(request: Request) {
  const { user, response } = await authorizeApi(request);
  if (!user) return response;
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
    const result = await withUserDatabase(user.sub, async (db) => {
      if (limit.kind === "clear") {
        await db.query("DELETE FROM public.budgets WHERE user_id = $1", [user.sub]);
        return { saved: true, global: null, cleared: true };
      }
      if (limit.kind === "missing") {
        const updated = await db.query(`UPDATE public.budgets SET alert_threshold_pct = $2
          WHERE user_id = $1 RETURNING id, monthly_limit_cents, alert_threshold_pct`,
          [user.sub, threshold.kind === "value" ? threshold.pct : DEFAULT_ALERT_THRESHOLD_PCT]);
        return updated.rows[0] ? { saved: true, global: updated.rows[0] } : null;
      }
      // An absent threshold preserves the existing value, even under concurrent writes.
      const updated = await db.query(`INSERT INTO public.budgets (user_id, monthly_limit_cents, alert_threshold_pct)
        VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET
        monthly_limit_cents = EXCLUDED.monthly_limit_cents,
        alert_threshold_pct = CASE WHEN $4 THEN EXCLUDED.alert_threshold_pct ELSE budgets.alert_threshold_pct END
        RETURNING id, monthly_limit_cents, alert_threshold_pct`,
        [user.sub, limit.cents, threshold.kind === "value" ? threshold.pct : DEFAULT_ALERT_THRESHOLD_PCT, threshold.kind === "value"]);
      return { saved: true, global: updated.rows[0] };
    });
    return result ? NextResponse.json(result) : NextResponse.json({ error: "No existing budget to update: provide monthly_limit_cents to create one" }, { status: 400 });
  } catch (error) { return apiFailure(error); }
}
