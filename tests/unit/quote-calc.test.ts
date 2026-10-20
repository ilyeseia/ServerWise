import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { CalcError, calculateQuote, type CalcLineInput } from "@/modules/quotes/calc";

const line = (over: Partial<CalcLineInput> = {}): CalcLineInput => ({
  quantity: "1",
  unitPrice: "100.00",
  ...over,
});

describe("calculateQuote: golden values", () => {
  it("computes a simple taxed line", () => {
    const result = calculateQuote([
      line({ quantity: "2", unitPrice: "1500.50", taxRatePct: "19" }),
    ]);
    expect(result.lines[0]).toMatchObject({
      gross: "3001.00",
      discount: "0.00",
      net: "3001.00",
      tax: "570.19", // 3001 x 0.19 = 570.19
      total: "3571.19",
    });
    expect(result.subtotal).toBe("3001.00");
    expect(result.taxTotal).toBe("570.19");
    expect(result.total).toBe("3571.19");
  });

  it("applies a line discount before tax", () => {
    const result = calculateQuote([
      line({ unitPrice: "1000", discountPct: "10", taxRatePct: "9" }),
    ]);
    expect(result.lines[0]).toMatchObject({
      gross: "1000.00",
      discount: "100.00",
      net: "900.00",
      tax: "81.00",
      total: "981.00",
    });
  });

  it("rounds half up at 2 decimals and stays stable", () => {
    // 0.005 -> 0.01 ; 1.005 x 1 cannot be entered (3 decimals price), so use quantity 0.005
    const result = calculateQuote([line({ quantity: "0.005", unitPrice: "1.00" })]);
    expect(result.lines[0]!.gross).toBe("0.01");
    expect(calculateQuote([line({ quantity: "0.005", unitPrice: "1.00" })])).toEqual(result);
  });

  it("avoids binary floating point errors", () => {
    // 0.1 + 0.2 style trap: three lines of 0.10 must sum to exactly 0.30
    const result = calculateQuote([
      line({ unitPrice: "0.10" }),
      line({ unitPrice: "0.10" }),
      line({ unitPrice: "0.10" }),
    ]);
    expect(result.subtotal).toBe("0.30");
  });

  it("handles an empty quote", () => {
    expect(calculateQuote([])).toEqual({
      lines: [],
      subtotal: "0.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
      margin: null,
    });
  });

  it("allows a free (zero price) line and a 100% discount", () => {
    const result = calculateQuote([
      line({ unitPrice: "0" }),
      line({ discountPct: "100", taxRatePct: "19" }),
    ]);
    expect(result.total).toBe("0.00");
  });
});

describe("calculateQuote: margin", () => {
  it("is computed only when every line has a known cost", () => {
    const known = calculateQuote([
      line({ quantity: "2", unitPrice: "1000", unitCost: "700" }),
      line({ unitPrice: "500", unitCost: "400" }),
    ]);
    expect(known.margin).toEqual({ amount: "700.00", pct: "28.00" }); // 2500 - 1800
  });

  it("is unknown (null), never guessed, when one cost is missing", () => {
    const result = calculateQuote([line({ unitCost: "50" }), line({ unitCost: null }), line()]);
    expect(result.margin).toBeNull();
  });

  it("has a null percentage when the net is zero", () => {
    const result = calculateQuote([line({ unitPrice: "0", unitCost: "0" })]);
    expect(result.margin).toEqual({ amount: "0.00", pct: null });
  });
});

describe("calculateQuote: input validation", () => {
  const code = (input: CalcLineInput) => {
    try {
      calculateQuote([input]);
    } catch (error) {
      return error instanceof CalcError ? error.code : "OTHER";
    }
    return "OK";
  };

  it("rejects malformed numbers", () => {
    for (const bad of ["", "abc", "1e3", "1,5", "1.", ".5", "NaN", "Infinity", " "]) {
      expect(code(line({ unitPrice: bad })), bad).toBe("INVALID_NUMBER");
    }
  });
  it("rejects zero or negative quantity and negative prices", () => {
    expect(code(line({ quantity: "0" }))).toBe("QUANTITY_NOT_POSITIVE");
    expect(code(line({ quantity: "-1" }))).toBe("QUANTITY_NOT_POSITIVE");
    expect(code(line({ unitPrice: "-1" }))).toBe("NEGATIVE_NOT_ALLOWED");
    expect(code(line({ unitCost: "-1" }))).toBe("NEGATIVE_NOT_ALLOWED");
  });
  it("rejects out-of-range percentages", () => {
    expect(code(line({ discountPct: "100.01" }))).toBe("PERCENT_OUT_OF_RANGE");
    expect(code(line({ taxRatePct: "-1" }))).toBe("NEGATIVE_NOT_ALLOWED");
    expect(code(line({ taxRatePct: "101" }))).toBe("PERCENT_OUT_OF_RANGE");
  });
  it("rejects more decimals than the database stores", () => {
    expect(code(line({ unitPrice: "1.005" }))).toBe("TOO_MANY_DECIMALS");
    expect(code(line({ quantity: "1.0001" }))).toBe("TOO_MANY_DECIMALS");
  });
  it("rejects amounts that do not fit numeric(14,2)", () => {
    expect(code(line({ quantity: "1000", unitPrice: "999999999999" }))).toBe("AMOUNT_TOO_LARGE");
  });
});

describe("calculateQuote: invariants over pseudo-random inputs", () => {
  // Deterministic generator so failures are reproducible.
  let seed = 123456789;
  const rand = (max: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % max;
  };
  const money = (maxUnits: number) => `${rand(maxUnits)}.${String(rand(100)).padStart(2, "0")}`;

  it("keeps sums consistent and amounts non-negative", () => {
    for (let run = 0; run < 300; run++) {
      const count = 1 + rand(8);
      const inputs: CalcLineInput[] = Array.from({ length: count }, () => ({
        quantity: `${1 + rand(20)}.${String(rand(1000)).padStart(3, "0")}`,
        unitPrice: money(500000),
        discountPct: `${rand(101)}.${rand(2) ? "50" : "00"}`.replace(/^100\.50$/, "100.00"),
        taxRatePct: ["0", "9", "19"][rand(3)]!,
        unitCost: rand(2) ? money(400000) : null,
      }));
      const result = calculateQuote(inputs);

      const sum = (values: string[]) => values.reduce((acc, v) => acc.plus(v), new Decimal(0));
      expect(result.subtotal).toBe(sum(result.lines.map((l) => l.net)).toFixed(2));
      expect(result.taxTotal).toBe(sum(result.lines.map((l) => l.tax)).toFixed(2));
      expect(result.discountTotal).toBe(sum(result.lines.map((l) => l.discount)).toFixed(2));
      expect(result.total).toBe(new Decimal(result.subtotal).plus(result.taxTotal).toFixed(2));
      for (const l of result.lines) {
        expect(new Decimal(l.gross).minus(l.discount).toFixed(2)).toBe(l.net);
        expect(new Decimal(l.net).plus(l.tax).toFixed(2)).toBe(l.total);
        expect(new Decimal(l.discount).gte(0)).toBe(true);
        expect(new Decimal(l.net).lte(l.gross)).toBe(true);
      }
      // Deterministic: the same input always yields the same output.
      expect(calculateQuote(inputs)).toEqual(result);
    }
  });
});
