export function truncateChartLabel(value: unknown, maximumLength = 18): string {
  const label = String(value ?? "").trim();
  if (label.length <= maximumLength) return label;
  if (maximumLength <= 1) return "…";
  return `${label.slice(0, maximumLength - 1).trimEnd()}…`;
}

export function compactChartNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("vi-VN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

export const responsiveTooltipStyle = {
  maxWidth: "min(22rem, calc(100vw - 2rem))",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
} as const;
