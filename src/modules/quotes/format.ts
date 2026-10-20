/**
 * Display-only money formatting. Amounts are carried as exact decimal strings; converting to a
 * JS number here is safe for display because they fit numeric(14,2) (well below 2^53).
 */
export function formatMoney(value: string, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
