/**
 * Money in the form: reais as the partner types them, cents as the API
 * wants them (a string of digits, ADR 0005). Only digits are moved
 * around, never a float, so no cent is ever lost.
 */

// The contract's limit (packages/contracts, amountCents).
const MAX_DIGITS = 12;

// "1.250,00" or "1250,5": a comma is always the decimal mark.
const WITH_COMMA = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;
// "12.5" or "12.50": a phone keypad with only a dot.
const DOT_AS_DECIMAL = /^(\d+)\.(\d{1,2})$/;
// "1.250" or "1.250.000": three digits after each dot group thousands.
const DOT_AS_THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/;
const WHOLE = /^\d+$/;

/**
 * Reads what the partner typed as cents, or null when it is not a
 * positive amount. Example: "1.250,5" gives "125050".
 */
export function parseReaisToCents(input: string): string | null {
  const text = input.trim().replace(/^R\$\s*/, "");

  const comma = WITH_COMMA.exec(text) ?? DOT_AS_DECIMAL.exec(text);
  if (comma) return toCents(comma[1]!, comma[2]!);
  if (DOT_AS_THOUSANDS.test(text) || WHOLE.test(text)) return toCents(text, "");
  return null;
}

function toCents(reais: string, fraction: string): string | null {
  const digits = (reais.replaceAll(".", "") + fraction.padEnd(2, "0")).replace(
    /^0+/,
    "",
  );
  if (digits === "" || digits.length > MAX_DIGITS) return null;
  return digits;
}

/**
 * Shows cents as reais, without the "R$". Example: "125000" gives
 * "1.250,00".
 */
export function formatCents(cents: string): string {
  const padded = cents.padStart(3, "0");
  const reais = padded.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ".");
  return `${reais},${padded.slice(-2)}`;
}
