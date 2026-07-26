// Shared focus-ring utility classes.
// Single responsibility: one definition of "this element is focused", so
// every interactive element in the app rings the same way.

/**
 * Ring-offset needs the surface colour behind it, and the app's dark
 * surface is slate-900 -- without the dark override the offset punches a
 * white halo through dark mode.
 */
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900";

/** For elements sitting directly on a card or popover rather than the
 *  page, where an offset ring would collide with the border. */
export const FOCUS_RING_TIGHT =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
