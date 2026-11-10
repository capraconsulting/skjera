import { describe, expect, it } from "vitest";
// @ts-expect-error The checked command is a plain Node module.
import { findComponentBoundaryViolations } from "../../../../dev/check-css-module-imports.mjs";
import { Button } from "../../src/components/controls/Button.tsx";

describe("Button", () => {
  it("uses the same owned style composition for buttons and links (AC-1)", () => {
    const defaultButton = Button({ children: "Save" });
    const button = Button({
      children: "Save",
      variant: "primary",
      className: "caller-class",
    });
    const link = Button({
      as: "a",
      children: "Open",
      href: "/event",
      variant: "primary",
      className: "caller-class",
    });

    expect(button.type).toBe("button");
    expect(link.type).toBe("a");
    expect(button.props.className).toBe(link.props.className);
    expect(button.props.className).toContain("caller-class");
    expect(button.props.className).not.toBe("caller-class");
    expect(button.props.className).not.toBe(defaultButton.props.className);
    expect(() => {
      // @ts-expect-error Native anchors do not have a disabled attribute.
      Button({ as: "a", disabled: true });
      // @ts-expect-error Native buttons do not have an href attribute.
      Button({ href: "/event" });
    }).toBeTypeOf("function");
  });
});

describe("component boundaries", () => {
  it("allows owned selects and rejects raw selects elsewhere (AC-2)", () => {
    expect(
      findComponentBoundaryViolations(
        "packages/app/src/components/controls/Input.tsx",
        'export const field = <select name="kind" />;',
      ),
    ).toEqual([]);
    expect(
      findComponentBoundaryViolations(
        "packages/app/src/routes/studio/lists/Team.tsx",
        'export const field = <select name="kind" />;',
      ),
    ).toEqual([
      "packages/app/src/routes/studio/lists/Team.tsx:1: use Select instead of a raw <select>",
    ]);
  });

  it("rejects window.confirm and globalThis.confirm but not a local confirm (AC-1)", () => {
    const file = "packages/app/src/routes/studio/lists/Team.tsx";
    expect(
      findComponentBoundaryViolations(file, 'window.confirm("Sure?");'),
    ).toEqual([`${file}:1: use useConfirm instead of window.confirm`]);
    expect(
      findComponentBoundaryViolations(file, 'globalThis.confirm("Sure?");'),
    ).toEqual([`${file}:1: use useConfirm instead of window.confirm`]);
    expect(
      findComponentBoundaryViolations(
        file,
        'const yes = await confirm({ question: "Sure?" });',
      ),
    ).toEqual([]);
  });

  it("allows owned and package CSS but identifies foreign local CSS (AC-3)", () => {
    expect(
      findComponentBoundaryViolations(
        "packages/app/src/components/controls/Button.tsx",
        [
          'import styles from "./Button.module.css";',
          'import calendar from "@daypicker/react/style.module.css";',
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      findComponentBoundaryViolations(
        "packages/app/src/components/menus/ThemeMenu.tsx",
        'import styles from "./Button.module.css";',
      ),
    ).toEqual([
      "packages/app/src/components/menus/ThemeMenu.tsx:1: import shared styles through Button.tsx, not Button.module.css",
    ]);
  });
});
