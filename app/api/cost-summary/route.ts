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
import { authorizeApi, apiFailure } from "@/lib/auth/session";
import { getCostTotal } from "@/lib/db/data";

type Mode = "yesterday" | "month" | "ytd" | "ltd";

function parseMonthValue(monthParam: string | null, yearParam: string | null, timeZone: string) {
  const fallback = getCurrentLocalDateParts(timeZone);

  const parsedMonth = Number(monthParam);
  const parsedYear = Number(yearParam);

  const month = Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : fallback.month;
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fallback.year;

  return { year, month };
}

export async function GET(request: NextRequest) {
  const { user, response } = await authorizeApi();
  if (!user) return response;

  const timeZone = getAppTimeZone();
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode: Mode =
    modeParam === "yesterday" || modeParam === "ytd" || modeParam === "month" || modeParam === "ltd"
      ? modeParam
      : "month";

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
  } else if (mode === "ltd") {
    // LTD = 全生命周期,传足够宽的日期范围让 RPC 汇总所有行。
    // RPC 在数据库端 SUM,不经 PostgREST 行数截断。
    start = "2000-01-01";
    endExclusive = "2100-01-01";
    label = "Lifetime to Date";
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

  try {
    const totalCents = toNumber(await getCostTotal(user.sub, start, endExclusive));
    return NextResponse.json({ mode, timeZone, label, start, endExclusive, totalCents, totalUsd: totalCents / 100 });
  } catch (error) { return apiFailure(error); }
}
