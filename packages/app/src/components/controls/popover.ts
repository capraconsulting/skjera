/**
 * Places an open popover (which lives in the browser's top layer) under its
 * trigger, aligned to the trigger's start or end edge and kept on screen:
 * above the trigger when there's more room there.
 */
export const placeUnder = (
  popover: HTMLElement,
  trigger: HTMLElement | null,
  align: "start" | "end" = "start",
) => {
  if (trigger === null) return;
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const below = window.innerHeight - rect.bottom - 4 - margin;
  const above = rect.top - 4 - margin;
  const top =
    height > below && above > below
      ? Math.max(rect.top - 4 - height, margin)
      : rect.bottom + 4;
  const left =
    align === "end" ? rect.right - width : Math.max(rect.left, margin);
  popover.style.position = "fixed";
  popover.style.margin = "0";
  popover.style.top = `${top}px`;
  popover.style.left = `${Math.min(
    Math.max(left, margin),
    window.innerWidth - width - margin,
  )}px`;
};
