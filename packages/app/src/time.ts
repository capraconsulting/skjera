const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "just now", "5 minutes ago", "yesterday", … */
export const timeAgo = (date: Date, now = new Date()): string => {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

/** "30 Sep 2026" */
export const formatDate = (date: Date): string =>
  date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
