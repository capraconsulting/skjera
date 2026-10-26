import { useState } from "react";

/** The widths of the studio's teams and events columns, in rem. */
export type ColumnWidths = { readonly teams: number; readonly events: number };

export type Column = keyof ColumnWidths;

export const defaultWidths: ColumnWidths = { teams: 16, events: 22 };
export const minWidth = 12;
export const maxWidth = 32;

const storageKey = "skjera-studio-columns";

/** `rem` within the limits, to a quarter of a rem. */
export const clampWidth = (rem: number): number =>
  Math.min(maxWidth, Math.max(minWidth, Math.round(rem * 4) / 4));

/** The widths stored, with the default for any that are missing or wrong. */
export const readWidths = (stored: string | null): ColumnWidths => {
  let parsed: unknown = null;
  try {
    parsed = stored === null ? null : JSON.parse(stored);
  } catch {
    // Not ours, or damaged: the defaults.
  }
  const widths: Partial<Record<Column, unknown>> =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : {};
  const width = (column: Column) => {
    const value = widths[column];
    return typeof value === "number" && Number.isFinite(value)
      ? clampWidth(value)
      : defaultWidths[column];
  };
  return { teams: width("teams"), events: width("events") };
};

const load = (): ColumnWidths => {
  try {
    return readWidths(localStorage.getItem(storageKey));
  } catch {
    return defaultWidths;
  }
};

const save = (widths: ColumnWidths) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Private browsing: the widths last until the page is closed.
  }
};

/** The columns' widths, remembered in this browser, and a way to change one. */
export function useColumnWidths() {
  const [widths, setWidths] = useState(load);
  const resize = (column: Column, rem: number) => {
    setWidths((current) => {
      const next = { ...current, [column]: clampWidth(rem) };
      save(next);
      return next;
    });
  };
  return { widths, resize };
}
