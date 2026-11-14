// How an amount reads, the same on the screens and in the notifications.

/**
 * Shows cents as reais, without the "R$". Example: "125000" gives
 * "1.250,00". Only digits are moved around, never a float (ADR 0005).
 */
export function formatCents(cents: string): string {
  const padded = cents.padStart(3, "0");
  const reais = padded.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ".");
  return `${reais},${padded.slice(-2)}`;
}
