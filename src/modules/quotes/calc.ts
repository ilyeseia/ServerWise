import Decimal from "decimal.js";

/**
 * Deterministic quotation arithmetic. Pure: no I/O, no clock, no AI.
 *
 * Money is handled as Decimal and exchanged as plain decimal strings ("1234.50"), never as
 * floats. Rounding is explicit and happens at fixed points, so the result is reproducible and
 * the invariants below always hold:
 *   - line net      = round(quantity x unitPrice x (1 - discountPct/100))
 *   - line tax      = round(line net x taxRatePct/100)
 *   - subtotal      = sum of line nets          (exact: addition of 2-dp values)
 *   - taxTotal      = sum of line taxes
 *   - total         = subtotal + taxTotal
 * Rounding is half-up to 2 decimals (DZD is quoted with centimes).
 */

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Bump when arithmetic behaviour changes; every issued quotation records it. */
export const CALC_VERSION = 1;

export const MONEY_SCALE = 2;
/** Upper bound that fits numeric(14,2). */
export const MAX_MONEY = new MoneyDecimal("999999999999.99");

export type CalcLineInput = {
  /** Quantity > 0, up to 3 decimals (e.g. 1.5 hours). */
  quantity: string;
  /** Unit price >= 0, up to 2 decimals. */
  unitPrice: string;
  /** Percentage discount 0..100 (up to 2 decimals). Default 0. */
  discountPct?: string;
  /** Tax rate in percent >= 0 (up to 2 decimals). Default 0. Comes from configuration. */
  taxRatePct?: string;
  /** What the line costs the business, per unit; optional, used only for margin. */
  unitCost?: string | null;
};

export type CalcLineResult = {
  gross: string;
  discount: string;
  net: string;
  tax: string;
  total: string;
  /** Cost of the line (quantity x unitCost) or null when the cost is unknown. */
  cost: string | null;
};

export type CalcResult = {
  lines: CalcLineResult[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  /**
   * Margin on net sales, only when EVERY line has a known cost; otherwise null (unknown is not
   * guessed). marginPct is null when the net is zero.
   */
  margin: { amount: string; pct: string | null } | null;
};

export class CalcError extends Error {
  constructor(
    readonly code:
      | "INVALID_NUMBER"
      | "NEGATIVE_NOT_ALLOWED"
      | "QUANTITY_NOT_POSITIVE"
      | "PERCENT_OUT_OF_RANGE"
      | "TOO_MANY_DECIMALS"
      | "AMOUNT_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "CalcError";
  }
}

function decimalPlaces(value: Decimal): number {
  return value.decimalPlaces();
}

/** Parses a plain decimal string strictly (no exponent, no thousands separators). */
export function parseDecimal(value: string, field: string, maxPlaces: number): Decimal {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new CalcError("INVALID_NUMBER", `${field} is not a valid decimal number`);
  }
  const parsed = new MoneyDecimal(value.trim());
  if (decimalPlaces(parsed) > maxPlaces) {
    throw new CalcError("TOO_MANY_DECIMALS", `${field} has more than ${maxPlaces} decimals`);
  }
  return parsed;
}

function nonNegative(value: Decimal, field: string): Decimal {
  if (value.isNegative())
    throw new CalcError("NEGATIVE_NOT_ALLOWED", `${field} cannot be negative`);
  return value;
}

function percent(value: string | undefined, field: string): Decimal {
  const parsed = nonNegative(parseDecimal(value ?? "0", field, 2), field);
  if (parsed.greaterThan(100)) {
    throw new CalcError("PERCENT_OUT_OF_RANGE", `${field} must be between 0 and 100`);
  }
  return parsed;
}

function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

function checkSize(value: Decimal, field: string): Decimal {
  if (value.abs().greaterThan(MAX_MONEY)) {
    throw new CalcError("AMOUNT_TOO_LARGE", `${field} exceeds the supported maximum`);
  }
  return value;
}

const fixed = (value: Decimal) => value.toFixed(MONEY_SCALE);

export function calculateQuote(inputs: readonly CalcLineInput[]): CalcResult {
  let subtotal = new MoneyDecimal(0);
  let discountTotal = new MoneyDecimal(0);
  let taxTotal = new MoneyDecimal(0);
  let costTotal: Decimal | null = new MoneyDecimal(0);

  const lines = inputs.map((input, index): CalcLineResult => {
    const label = `line ${index + 1}`;
    const quantity = parseDecimal(input.quantity, `${label} quantity`, 3);
    if (!quantity.greaterThan(0)) {
      throw new CalcError("QUANTITY_NOT_POSITIVE", `${label} quantity must be greater than zero`);
    }
    const unitPrice = nonNegative(
      parseDecimal(input.unitPrice, `${label} unit price`, 2),
      `${label} unit price`,
    );
    const discountPct = percent(input.discountPct, `${label} discount`);
    const taxRatePct = percent(input.taxRatePct, `${label} tax rate`);

    const gross = checkSize(roundMoney(quantity.times(unitPrice)), `${label} amount`);
    const net = roundMoney(gross.times(new MoneyDecimal(100).minus(discountPct)).dividedBy(100));
    const discount = gross.minus(net);
    const tax = roundMoney(net.times(taxRatePct).dividedBy(100));

    subtotal = subtotal.plus(net);
    discountTotal = discountTotal.plus(discount);
    taxTotal = taxTotal.plus(tax);

    let cost: Decimal | null = null;
    if (input.unitCost !== undefined && input.unitCost !== null) {
      const unitCost = nonNegative(
        parseDecimal(input.unitCost, `${label} unit cost`, 2),
        `${label} unit cost`,
      );
      cost = roundMoney(quantity.times(unitCost));
    }
    costTotal = cost === null || costTotal === null ? null : costTotal.plus(cost);

    return {
      gross: fixed(gross),
      discount: fixed(discount),
      net: fixed(net),
      tax: fixed(tax),
      total: fixed(net.plus(tax)),
      cost: cost === null ? null : fixed(cost),
    };
  });

  const total = checkSize(subtotal.plus(taxTotal), "total");
  checkSize(subtotal, "subtotal");

  let margin: CalcResult["margin"] = null;
  if (lines.length > 0 && costTotal !== null) {
    const amount = subtotal.minus(costTotal);
    margin = {
      amount: fixed(amount),
      pct: subtotal.isZero()
        ? null
        : amount
            .times(100)
            .dividedBy(subtotal)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2),
    };
  }

  return {
    lines,
    subtotal: fixed(subtotal),
    discountTotal: fixed(discountTotal),
    taxTotal: fixed(taxTotal),
    total: fixed(total),
    margin,
  };
}
