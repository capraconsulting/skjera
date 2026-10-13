import { m } from "@skjera/i18n/messages";
import type { Identity } from "@skjera/oauth/api";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { forgetLocalCopies } from "../documents/repo.ts";
import { initials } from "./Avatars.tsx";
import { Dropdown, DropdownItem, DropdownLink } from "./Dropdown.tsx";
import styles from "./UserMenu.module.css";

/** What to call someone: their name from the login, else their email. */
export const displayName = (me: Identity) => me.name ?? me.email ?? me.subject;

/** Who is signed in: their account's settings, and logging out. */
export function UserMenu({ me }: { readonly me: Identity }) {
  const name = displayName(me);
  return (
    <Dropdown
      label={m.common_account_menu()}
      trigger={{
        className: styles.trigger,
        title: me.email ?? name,
        testId: "me",
        content: (
          <>
            <span className={styles.avatar} aria-hidden="true">
              {initials(name).toUpperCase()}
            </span>
            <span className={styles.name}>{name}</span>
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          </>
        ),
      }}
    >
      {(close) => (
        <>
          <div className={styles.who}>
            <span className={styles.whoName}>{name}</span>
            {me.email === undefined || me.email === name ? null : (
              <span className={styles.whoEmail}>{me.email}</span>
            )}
          </div>
          <DropdownLink to="/account" onClick={close}>
            <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
            {m.account_settings()}
          </DropdownLink>
          <form
            method="post"
            action="/auth/logout"
            // Deletes the local copies of what they edited first, so they
            // don't stay behind on a shared computer.
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void forgetLocalCopies(me)
                .catch(() => undefined)
                .then(() => form.submit());
            }}
          >
            <DropdownItem type="submit">
              <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
              {m.common_log_out()}
            </DropdownItem>
          </form>
        </>
      )}
    </Dropdown>
  );
}
