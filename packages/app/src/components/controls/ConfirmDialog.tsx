import { m } from "@skjera/i18n/messages";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "./Button.tsx";
import { Dialog, dialogStyles } from "./Dialog.tsx";

export type Question = {
  /** The question, shown as the dialog's title. */
  readonly question: string;
  /** The button that goes ahead, named for the action: «Delete», «Unpublish». */
  readonly action: string;
  /** The action destroys something: its button is the danger variant. */
  readonly danger?: boolean;
};

/**
 * Asks a question in a dialog of the app's own. `confirm` answers true for
 * the action's button, and false for Cancel, Escape, another question asked
 * meanwhile, or the component going away. Render `confirmation` once in the
 * component, beside any dialog it is opened from, never inside one: a
 * `<dialog>`'s `close` event passes up the component tree.
 */
export function useConfirm(): {
  readonly confirm: (asked: Question) => Promise<boolean>;
  readonly confirmation: ReactNode;
} {
  const [asked, setAsked] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<((yes: boolean) => void) | null>(null);

  const settle = useCallback((yes: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    resolve?.(yes);
  }, []);

  const confirm = useCallback(
    (question: Question) =>
      new Promise<boolean>((resolve) => {
        settle(false);
        pending.current = resolve;
        setAsked(question);
        setOpen(true);
      }),
    [settle],
  );

  useEffect(() => () => settle(false), [settle]);

  const answer = (yes: boolean) => {
    settle(yes);
    setOpen(false);
  };

  const confirmation = (
    <Dialog
      open={open}
      role="alertdialog"
      title={asked?.question ?? ""}
      onClose={() => answer(false)}
    >
      <div className={dialogStyles.actions}>
        <Button onClick={() => answer(false)}>{m.common_cancel()}</Button>
        <Button
          variant={asked?.danger === true ? "danger" : "primary"}
          onClick={() => answer(true)}
        >
          {asked?.action}
        </Button>
      </div>
    </Dialog>
  );

  return { confirm, confirmation };
}
