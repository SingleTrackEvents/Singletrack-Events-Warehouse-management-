/** "under 1¢", "9¢", "$1.20". Rough by design: the function estimates from published rates. */
export function formatCost(usd: number): string {
  if (usd < 0.005) return 'under 1¢';
  if (usd < 1) return `${Math.round(usd * 100)}¢`;
  return `$${usd.toFixed(2)}`;
}
