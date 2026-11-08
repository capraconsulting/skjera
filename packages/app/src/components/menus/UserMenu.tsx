import { m } from "@skjera/i18n/messages";
import { type Identity, nameOf } from "@skjera/oauth/api";
import { appPaths } from "@skjera/paths";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { forgetLocalCopies } from "../../documents/repo.ts";
import { initials } from "../Avatars.tsx";
import { Dropdown, DropdownItem, DropdownLink } from "../controls/Dropdown.tsx";
import styles from "./UserMenu.module.css";

/** What to call someone throughout the account UI. */
export const displayName = (me: Identity) => nameOf(me);

/**
 * Their picture from the login, round; their initials where there is none or
 * it fails to load.
 */
function Avatar({
  picture,
  name,
}: {
  readonly picture: string | undefined;
  readonly name: string;
}) {
  const [failed, setFailed] = useState(false);
  if (picture === undefined || failed) {
    return (
      <span className={styles.avatar} aria-hidden="true">
        {initials(name).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={styles.picture}
      src={picture}
      alt={m.account_profile_picture()}
      width={32}
      height={32}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

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
            <Avatar key={me.picture} picture={me.picture} name={name} />
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
          <DropdownLink to={appPaths.account} onClick={close}>
            <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
            {m.account_settings()}
          </DropdownLink>
          <form
            method="post"
            action={appPaths.logout}
            // Deletes the local copies of what they edited first, so they
            // don't stay behind on a shared computer.
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void forgetLocalCopies(me)
                .catch(() => window.alert(m.account_local_cleanup_failed()))
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
