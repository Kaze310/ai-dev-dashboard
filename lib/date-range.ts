const APP_TIMEZONE = "UTC";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");

  return { year, month, day };
}

export function getAppTimeZone() {
  // usage_records.date 当前语义是 provider 返回的 UTC bucket date，因此汇总按 UTC 计算。
  return APP_TIMEZONE;
}

export function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const { year, month, day } = getDatePartsInTimeZone(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function getMonthLabel(year: number, month: number, timeZone: string) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getDayLabel(ymd: string, timeZone: string) {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    // ymd 已是日期键，这里固定 UTC 稳定展示。
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getCurrentLocalDateParts(timeZone: string) {
  const today = formatYmdInTimeZone(new Date(), timeZone);
  const [yearStr, monthStr] = today.split("-");

  return {
    today,
    year: Number(yearStr),
    month: Number(monthStr),
  };
}

export function getMonthRange(year: number, month: number) {
  const start = `${year}-${pad2(month)}-01`;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const endExclusive = `${nextMonth.year}-${pad2(nextMonth.month)}-01`;

  return { start, endExclusive };
}

export function getTodayRange(timeZone: string) {
  const today = formatYmdInTimeZone(new Date(), timeZone);
  return {
    start: today,
    endExclusive: addDays(today, 1),
    label: getDayLabel(today, timeZone),
  };
}

export function getYtdRange(timeZone: string) {
  const { today, year } = getCurrentLocalDateParts(timeZone);
  const start = `${year}-01-01`;

  return {
    start,
    endExclusive: addDays(today, 1),
    label: `${getDayLabel(start, timeZone)} - ${getDayLabel(today, timeZone)}`,
  };
}
