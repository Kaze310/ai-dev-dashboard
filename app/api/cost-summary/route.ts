import { NextRequest, NextResponse } from "next/server";

import {
  getAppTimeZone,
  getCurrentLocalDateParts,
  getMonthLabel,
  getMonthRange,
  getTodayRange,
  getYtdRange,
} from "@/lib/date-range";
import { createClient } from "@/lib/supabase/server";

type Mode = "today" | "month" | "ytd";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseMonthValue(monthParam: string | null, yearParam: string | null, timeZone: string) {
  const fallback = getCurrentLocalDateParts(timeZone);

  const parsedMonth = Number(monthParam);
  const parsedYear = Number(yearParam);

  const month = Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : fallback.month;
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fallback.year;

  return { year, month };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timeZone = getAppTimeZone();
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode: Mode = modeParam === "today" || modeParam === "ytd" || modeParam === "month" ? modeParam : "month";

  let start = "";
  let endExclusive = "";
  let label = "";

  if (mode === "today") {
    const range = getTodayRange(timeZone);
    start = range.start;
    endExclusive = range.endExclusive;
    label = range.label;
  } else if (mode === "ytd") {
    const range = getYtdRange(timeZone);
    start = range.start;
    endExclusive = range.endExclusive;
    label = range.label;
  } else {
    const { year, month } = parseMonthValue(
      request.nextUrl.searchParams.get("month"),
      request.nextUrl.searchParams.get("year"),
      timeZone,
    );
    const range = getMonthRange(year, month);
    start = range.start;
    endExclusive = range.endExclusive;
    label = getMonthLabel(year, month, timeZone);
  }

  const { data, error } = await supabase
    .from("usage_records")
    .select("cost_cents")
    .eq("user_id", user.id)
    .gte("date", start)
    .lt("date", endExclusive);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalCents = (data ?? []).reduce((sum, row) => sum + toNumber(row.cost_cents), 0);

  return NextResponse.json({
    mode,
    timeZone,
    label,
    start,
    endExclusive,
    totalCents,
    totalUsd: totalCents / 100,
  });
}
