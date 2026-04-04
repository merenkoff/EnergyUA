export function formatUah(amount: number | bigint | { toString(): string } | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "object" && "toString" in amount ? Number(amount.toString()) : Number(amount);
  if (Number.isNaN(n)) return "—";
  return (
    new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency: "UAH",
      maximumFractionDigits: 0,
    }).format(n)
  );
}
