import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  RANGE_KEYS,
  averageMoney,
  csvCell,
  csvFilename,
  daysBetween,
  hoursBetween,
  inRange,
  mean,
  parseRange,
  rangeFor,
  share,
  sumMoney,
  toCsv,
} from "@/modules/reports/rules";

const NOW = new Date("2026-10-21T12:00:00.000Z");

describe("ranges", () => {
  it("knows three ranges and falls back to 30 days", () => {
    expect([...RANGE_KEYS]).toEqual(["30d", "90d", "365d"]);
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("7d")).toBe("30d");
    expect(parseRange("")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(null)).toBe("30d");
  });

  it("covers the last N days up to now", () => {
    const range = rangeFor("30d", NOW);
    expect(range.to).toEqual(NOW);
    expect(range.from.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(rangeFor("365d", NOW).from.toISOString()).toBe("2025-10-21T12:00:00.000Z");
  });

  it("includes the start, excludes the end, and ignores missing dates", () => {
    const range = rangeFor("30d", NOW);
    expect(inRange(range.from, range)).toBe(true);
    expect(inRange(new Date(range.from.getTime() - 1), range)).toBe(false);
    expect(inRange(new Date(NOW.getTime() - 1), range)).toBe(true);
    expect(inRange(NOW, range)).toBe(false);
    expect(inRange(null, range)).toBe(false);
    expect(inRange(undefined, range)).toBe(false);
  });
});

describe("exact arithmetic", () => {
  it("adds money without floating point error", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["1500.50", "3001.00", "0.05"])).toBe("4501.55");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });

  it("averages exactly, rounding half up, and has no average of nothing", () => {
    expect(averageMoney(["100.00", "200.00", "300.00"])).toBe("200.00");
    expect(averageMoney(["0.01", "0.02"])).toBe("0.02"); // 0.015 rounds up
    expect(averageMoney(["10.00"])).toBe("10.00");
    expect(averageMoney([])).toBeNull();
  });

  it("computes a share, and has none when nothing was decided", () => {
    expect(share(1, 3)).toBe("25.0");
    expect(share(2, 1)).toBe("66.7");
    expect(share(0, 5)).toBe("0.0");
    expect(share(4, 0)).toBe("100.0");
    expect(share(0, 0)).toBeNull();
  });

  it("averages numbers with one decimal", () => {
    expect(mean([1, 2, 4])).toBe("2.3");
    expect(mean([10])).toBe("10.0");
    expect(mean([])).toBeNull();
  });

  it("measures durations", () => {
    expect(daysBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-04T12:00:00Z"))).toBe(
      3.5,
    );
    expect(hoursBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T06:30:00Z"))).toBe(
      6.5,
    );
  });
});

describe("CSV cells", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("writes missing values as empty cells and numbers as they are", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(-12.5)).toBe("-12.5");
  });

  it("defuses spreadsheet formulas in text", () => {
    for (const attack of [
      '=HYPERLINK("http://evil","x")',
      "+SUM(A1:A9)",
      "-2+3",
      "@SUM(1)",
      "\t=1+1",
      "\r=1+1",
    ]) {
      const cell = csvCell(attack);
      const inner = cell.startsWith('"') ? cell.slice(1) : cell;
      expect(inner.startsWith("'"), attack).toBe(true);
    }
    // Ordinary text and a text that merely contains the characters are untouched.
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Amine -- Setif")).toBe("Amine -- Setif");
  });

  it("keeps accents and Arabic intact", () => {
    expect(csvCell("Café — خادم")).toBe("Café — خادم");
  });
});

describe("CSV files", () => {
  it("starts with a byte-order mark and ends rows with CRLF", () => {
    const csv = toCsv(
      ["name", "total"],
      [
        ["Alpha", 10],
        ["Beta, Inc.", null],
      ],
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('name,total\r\nAlpha,10\r\n"Beta, Inc.",\r\n');
  });

  it("protects headers and rows alike", () => {
    const csv = toCsv(["=bad"], [["@worse"]]);
    expect(csv).toContain("'=bad");
    expect(csv).toContain("'@worse");
  });

  it("builds a safe, dated file name", () => {
    expect(csvFilename("sales_quotes", "90d", NOW)).toBe(
      "serverwise-sales_quotes-90d-2026-10-21.csv",
    );
    expect(csvFilename("../../etc/passwd", "30d", NOW)).toBe(
      "serverwise-______etc_passwd-30d-2026-10-21.csv",
    );
  });
});
