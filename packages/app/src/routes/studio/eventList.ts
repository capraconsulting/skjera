import { useSyncExternalStore } from "react";

/** How the studio's lists of events are ordered, newest first. */
export type EventOrder = "updated" | "created" | "starts";
export const eventOrders: ReadonlyArray<EventOrder> = [
  "updated",
  "created",
  "starts",
];
export const defaultOrder: EventOrder = "updated";

/**
 * The events whose title or one of its tags contains `text`, trimmed and
 * ignoring case; all of them while `text` is blank.
 */
export const searchEvents = <
  T extends { readonly title: string; readonly tags: ReadonlyArray<string> },
>(
  events: ReadonlyArray<T>,
  text: string,
): ReadonlyArray<T> => {
  const needle = text.trim().toLowerCase();
  if (needle === "") return events;
  return events.filter(({ title, tags }) =>
    [title, ...tags].some((field) => field.toLowerCase().includes(needle)),
  );
};

type Sortable = {
  readonly id: string;
  readonly startsAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** The time the order goes by; none sorts last. */
const keyOf = (event: Sortable, order: EventOrder): number | null => {
  const time =
    order === "updated"
      ? event.updatedAt
      : order === "created"
        ? event.createdAt
        : event.startsAt;
  return time === null ? null : time.getTime();
};

/**
 * A new array, newest first by `order`: last edited, created, or the event's
 * start, with events that have no start last. Ties: most recently edited
 * first, then by id, so rows do not swap places as the list updates.
 */
export const sortEvents = <T extends Sortable>(
  events: ReadonlyArray<T>,
  order: EventOrder,
): ReadonlyArray<T> =>
  [...events].sort((a, b) => {
    const keyA = keyOf(a, order);
    const keyB = keyOf(b, order);
    if (keyA !== keyB) {
      if (keyA === null) return 1;
      if (keyB === null) return -1;
      return keyB - keyA;
    }
    const edited = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (edited !== 0) return edited;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

/** The order stored, or the default for one missing or unknown. */
export const readOrder = (stored: string | null): EventOrder =>
  eventOrders.find((order) => order === stored) ?? defaultOrder;

const storageKey = "skjera-studio-event-order";

const load = (): EventOrder => {
  try {
    return readOrder(localStorage.getItem(storageKey));
  } catch {
    // Private browsing: nothing remembered.
    return defaultOrder;
  }
};

let current = load();

/** Every list showing the order, told when it changes. */
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const choose = (order: EventOrder) => {
  current = order;
  try {
    localStorage.setItem(storageKey, order);
  } catch {
    // Private browsing: the choice lasts until the page is closed.
  }
  for (const listener of listeners) listener();
};

/**
 * The order chosen, remembered in this browser, and a way to choose another:
 * the same in every column that asks.
 */
export function useEventOrder() {
  const order = useSyncExternalStore(subscribe, () => current);
  return { order, choose };
}
