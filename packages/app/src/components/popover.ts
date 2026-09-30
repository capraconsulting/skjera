/**
 * Places an open popover (which lives in the browser's top layer) under its
 * trigger, aligned to the trigger's start or end edge and kept on screen.
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
  const left =
    align === "end" ? rect.right - width : Math.max(rect.left, margin);
  popover.style.position = "fixed";
  popover.style.margin = "0";
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${Math.min(
    Math.max(left, margin),
    window.innerWidth - width - margin,
  )}px`;
};
