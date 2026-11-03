import type { DocumentId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useState } from "react";
import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Button } from "../../components/Button.tsx";
import { usePageTitle } from "../../pageTitle.ts";
import { sayWhy } from "../../problems.ts";
import {
  cancelLinkFor,
  confirmCancelByLink,
  type Refused,
} from "../../site/guestSignups.ts";
import styles from "./CancelSignup.module.css";

/**
 * Reads the link's token with the server: the event's title when it is
 * good, else why not. Cancels nothing; opening a link must be safe, since
 * programs that check links in email open them too.
 */
export const cancelSignupLoader = async ({
  params,
  request,
}: LoaderFunctionArgs) => {
  const id = params.id as DocumentId;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  // Without a token there is nothing to ask the server about.
  const found: Awaited<ReturnType<typeof cancelLinkFor>> =
    token === ""
      ? { why: { problem: { _tag: "CancelLinkInvalid" } } }
      : await cancelLinkFor(id, token).catch(
          (): Refused => ({ why: undefined }),
        );
  return { id, token, found };
};

/** A cancel link's page: only pressing its button cancels. */
export function CancelSignup() {
  const { id, token, found } = useLoaderData<typeof cancelSignupLoader>();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = "title" in found ? found.title : "";
  usePageTitle({ page: "event", title });

  const confirm = () => {
    setBusy(true);
    setError(null);
    confirmCancelByLink(id as DocumentId, token).then(
      (refused) => {
        setBusy(false);
        if (refused === null) setDone(true);
        else setError(sayWhy(refused.why, m.common_something_wrong()));
      },
      () => {
        setBusy(false);
        setError(m.common_something_wrong());
      },
    );
  };

  const toEvent = (
    <Link to={`/events/${id}`} className={styles.toEvent}>
      {m.cancel_to_event()}
    </Link>
  );

  if (!("title" in found)) {
    return (
      <section className={styles.cancel}>
        <p className={styles.text} role="alert">
          {sayWhy(found.why, m.common_something_wrong())}
        </p>
        <div className={styles.actions}>{toEvent}</div>
      </section>
    );
  }
  return (
    <section className={styles.cancel}>
      <h1 className={styles.title}>{found.title}</h1>
      {done ? (
        <>
          <p className={styles.text} role="status">
            {m.cancel_done()}
          </p>
          <div className={styles.actions}>{toEvent}</div>
        </>
      ) : (
        <>
          {error === null ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="primary" disabled={busy} onClick={confirm}>
              {m.cancel_confirm()}
            </Button>
            {error === null ? null : toEvent}
          </div>
        </>
      )}
    </section>
  );
}
