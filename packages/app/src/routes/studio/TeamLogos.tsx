import type { TeamId, TeamLogos } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog, dialogStyles } from "../../components/Dialog.tsx";
import { acceptedImages, uploadImage } from "../../editor/uploadImage.ts";
import { type TeamChange, teams } from "../../sync/tables.ts";
import styles from "./TeamLogos.module.css";

type Theme = "light" | "dark";

/** The team's light-theme and dark-theme logos, each set on its own. */
export function TeamLogosDialog(props: {
  /** The team whose logos are shown; null: the dialog is closed. */
  readonly teamId: TeamId | null;
  readonly onClose: () => void;
}) {
  const { teamId, onClose } = props;
  // Live, so the dialog follows others' changes to the team.
  const team = useLiveQuery({
    query: (q) =>
      q
        .from({ team: teams.collection })
        .where(({ team }) => eq(team.id, teamId ?? "")),
  }).data[0];
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={teamId !== null && team !== undefined}
      title={m.studio_team_logo_title()}
      onClose={close}
    >
      {team === undefined ? null : (
        <>
          <div className={styles.fields}>
            <LogoField
              theme="light"
              teamId={team.id}
              logo={team.logo}
              onError={setError}
            />
            <LogoField
              theme="dark"
              teamId={team.id}
              logo={team.logoDark}
              onError={setError}
            />
          </div>
          {error === null ? null : (
            <p role="alert" className={dialogStyles.error}>
              {error}
            </p>
          )}
          <p className={styles.hint}>{m.studio_team_logo_hint()}</p>
          <div className={dialogStyles.actions}>
            <Button onClick={close}>{m.common_close()}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** One theme's logo: shown, chosen, replaced or removed. */
function LogoField(props: {
  readonly theme: Theme;
  readonly teamId: TeamId;
  readonly logo: TeamLogos["logo"];
  /** Uploading or saving failed, with a message to show. */
  readonly onError: (message: string | null) => void;
}) {
  const { theme, teamId, logo, onError } = props;
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const light = theme === "light";

  // The logo shows right away; the server's refusal undoes it.
  const write = (url: string | null) => {
    const logos = light ? { logo: url } : { logoDark: url };
    const metadata: TeamChange = { logos };
    teams.collection
      .update(teamId, { metadata }, (team) => {
        if (light) team.logo = url;
        else team.logoDark = url;
      })
      .isPersisted.promise.catch((failure: Error) => onError(failure.message));
  };

  const use = async (file: File | undefined) => {
    if (file === undefined) return;
    onError(null);
    setUploading(true);
    try {
      write(await uploadImage(file));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  return (
    <fieldset className={styles.field}>
      <legend className={styles.legend}>
        {light ? m.studio_team_logo_light() : m.studio_team_logo_dark()}
      </legend>
      {logo === null ? null : (
        <img
          className={styles.preview}
          src={logo}
          alt={
            light
              ? m.studio_team_logo_light_image()
              : m.studio_team_logo_dark_image()
          }
          aria-busy={uploading}
        />
      )}
      <div className={styles.actions}>
        <Button onClick={() => picker.current?.click()} disabled={uploading}>
          {logo === null
            ? m.studio_team_logo_choose()
            : m.studio_team_logo_replace()}
        </Button>
        {logo === null ? null : (
          <Button
            variant="ghost"
            onClick={() => {
              onError(null);
              write(null);
            }}
            disabled={uploading}
          >
            {m.studio_team_logo_remove()}
          </Button>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept={acceptedImages}
        aria-label={
          light
            ? m.studio_team_logo_light_file()
            : m.studio_team_logo_dark_file()
        }
        hidden
        onChange={(event) => {
          void use(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </fieldset>
  );
}
