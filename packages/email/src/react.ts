import { render, toPlainText } from "@react-email/render";
import { Effect } from "effect";
import type { ReactElement } from "react";

// Templates are React Email components (from "react-email"): rendered to
// HTML, with the plain text version taken from it.

/** A rendered template: `html` and `text` for a `Message`. */
export interface Rendered {
  readonly html: string;
  readonly text: string;
}

export const renderEmail = (template: ReactElement): Effect.Effect<Rendered> =>
  Effect.promise(async () => {
    const html = await render(template);
    return { html, text: toPlainText(html) };
  });
