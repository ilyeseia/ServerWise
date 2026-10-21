import Decimal from "decimal.js";

/**
 * Pure helpers for the reports: time ranges, exact arithmetic and CSV. No I/O and no clock (callers
 * pass `now`), so every figure is reproducible and unit-tested. Money is added with `decimal.js`
 * and kept as exact strings; nothing here is estimated, and an empty set gives `null`, never zero
 * presented as a result.
 */

// ---------------------------------------------------------------------------------------------
// Time ranges
// ---------------------------------------------------------------------------------------------

export const RANGE_KEYS = ["30d", "90d", "365d"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const DEFAULT_RANGE: RangeKey = "30d";

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<RangeKey, number> = { "30d": 30, "90d": 90, "365d": 365 };

export function parseRange(value: string | null | undefined): RangeKey {
  return RANGE_KEYS.find((key) => key === value) ?? DEFAULT_RANGE;
}

export interface DateRange {
  /** Inclusive start. */
  from: Date;
  /** Exclusive end (the moment of the report). */
  to: Date;
}

/** The last N days up to `now`. */
export function rangeFor(key: RangeKey, now: Date): DateRange {
  return { from: new Date(now.getTime() - RANGE_DAYS[key] * DAY_MS), to: now };
}

export function inRange(date: Date | null | undefined, range: DateRange): boolean {
  return Boolean(date) && date! >= range.from && date! < range.to;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Exact sum of decimal strings, as a 2-decimal string. */
export function sumMoney(values: readonly string[]): string {
  return values.reduce((sum, value) => sum.plus(value), new Money(0)).toFixed(2);
}

/** Exact mean of decimal strings (2 decimals), or null when there is nothing to average. */
export function averageMoney(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return new Money(sumMoney(values)).dividedBy(values.length).toFixed(2);
}

/** `part / (part + other)` as a percentage with one decimal, or null when both are zero. */
export function share(part: number, other: number): string | null {
  const total = part + other;
  if (total === 0) return null;
  return new Money(part).times(100).dividedBy(total).toFixed(1);
}

/** Mean of numbers with one decimal, or null when empty. */
export function mean(values: readonly number[]): string | null {
  if (values.length === 0) return null;
  return new Money(values.reduce((a, b) => a + b, 0)).dividedBy(values.length).toFixed(1);
}

/** Whole-day difference as a fractional number of days. */
export const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;
export const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

export type CsvValue = string | number | null | undefined;

/**
 * A spreadsheet treats a cell that starts with = + - @ (or a tab / carriage return) as a formula,
 * so a customer called `=HYPERLINK(...)` could run something when a CSV is opened. Text cells that
 * start that way get a leading apostrophe, which spreadsheets show as plain text. Numbers are
 * written as they are (a negative number is not an attack).
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** UTF-8 byte-order mark: it makes Excel read Arabic and French accents correctly. */
export const CSV_BOM = "﻿";

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** A file name that is safe in a download header. */
export function csvFilename(section: string, range: RangeKey, now: Date): string {
  const safe = section.replace(/[^a-z0-9_-]/gi, "_");
  return `serverwise-${safe}-${range}-${now.toISOString().slice(0, 10)}.csv`;
}
