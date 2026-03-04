import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type ProviderBudgetPutBody = {
  monthly_limit_cents?: number | null;
  alert_threshold_pct?: number;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  return NaN;
}

function normalizeThreshold(value: unknown): number {
  const parsed = Math.round(toNumber(value));
  if (!Number.isFinite(parsed)) {
    return 80;
  }

  return Math.min(100, Math.max(1, parsed));
}

function normalizeMonthlyLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Math.round(toNumber(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { providerId } = await context.params;

  let body: ProviderBudgetPutBody;
  try {
    body = (await request.json()) as ProviderBudgetPutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const monthlyLimit = normalizeMonthlyLimit(body.monthly_limit_cents);
  const alertThreshold = normalizeThreshold(body.alert_threshold_pct);

  const { data: provider, error: queryError } = await supabase
    .from("providers")
    .select("id, user_id")
    .eq("id", providerId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!provider?.id) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("providers")
    .update({
      monthly_limit_cents: monthlyLimit,
      alert_threshold_pct: alertThreshold,
    })
    .eq("id", provider.id)
    .eq("user_id", user.id)
    .select("id, name, monthly_limit_cents, alert_threshold_pct")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, provider: data });
}
