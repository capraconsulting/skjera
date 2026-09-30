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

/** A "2026-10-15" calendar date as a local Date, so it shows as that day. */
export const fromIsoDate = (iso: string): Date => {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
};

/** A local Date as a "2026-10-15" calendar date. */
export const toIsoDate = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

/** "Thursday, October 15, 2026" */
export const formatLongDate = (iso: string): string =>
  fromIsoDate(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
