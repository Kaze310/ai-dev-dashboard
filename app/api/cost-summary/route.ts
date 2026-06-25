import { NextRequest, NextResponse } from "next/server";

import {
  getAppTimeZone,
  getCurrentLocalDateParts,
  getMonthLabel,
  getMonthRange,
  getYesterdayRange,
  getYtdRange,
} from "@/lib/date-range";
import { toNumber } from "@/lib/normalize";
import { createClient } from "@/lib/supabase/server";

type Mode = "yesterday" | "month" | "ytd";

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
  const mode: Mode = modeParam === "yesterday" || modeParam === "ytd" || modeParam === "month" ? modeParam : "month";

  let start = "";
  let endExclusive = "";
  let label = "";

  if (mode === "yesterday") {
    const range = getYesterdayRange(timeZone);
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

  // 汇总下推数据库:此前 select 原始行再 JS 求和,PostgREST 默认 1000 行
  // 上限会静默截断(YTD 必然超限),总额偏小且无任何报错。
  const { data, error } = await supabase.rpc("usage_cost_total", {
    p_start: start,
    p_end_exclusive: endExclusive,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalCents = toNumber(data);

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
