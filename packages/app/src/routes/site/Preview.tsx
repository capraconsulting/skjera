import * as A from "@automerge/automerge/slim";
import {
  DocumentId,
  type EventContent,
  eventPreview,
  isVersion,
  type Organizer,
  type RichText,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths, appSearch } from "@skjera/paths";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Schema } from "effect";
import { useMemo } from "react";
import {
  data,
  Link,
  type LoaderFunctionArgs,
  useLoaderData,
} from "react-router";
import { openDraft, setLocalUser } from "../../documents/repo.ts";
import { useVersion } from "../../documents/version.ts";
import { usePageTitle } from "../../pageTitle.ts";
import { fetchMe } from "../../site/client.ts";
import { hasHubSpot, loadAfresh } from "../../site/hubSpot.ts";
import { attendees, documents, events, teams } from "../../sync/tables.ts";
import { EventView, eventPageStyles, useSignups } from "./EventPage.tsx";
import styles from "./Preview.module.css";

const isDocumentId = Schema.is(DocumentId);

/**
 * The site's header around the preview, as the site's loader gives it, but
 * with HubSpot kept out: it would be handed a draft's address and title. A
 * page that already runs HubSpot opens the preview as a fresh page.
 */
export const previewSiteLoader = ({ request }: { request: Request }) =>
  hasHubSpot() ? loadAfresh(request.url) : fetchMe();

/**
 * Opens the draft for the preview. Nobody logged in, an id that is not a
 * document's, a `version` in the address that is not change hashes, or a
 * draft that is not there is a 404, as an unpublished event's page is.
 */
export const previewLoader = async ({
  params,
  request,
}: LoaderFunctionArgs) => {
  const id = params.id as DocumentId;
  const me = await fetchMe();
  if (me === null || !isDocumentId(id)) {
    throw data("Event not found", { status: 404 });
  }
  // An earlier version of the draft, given as its heads joined by commas.
  const asked = appSearch.version(request.url);
  const heads = asked === null ? null : asked.split(",");
  if (heads !== null && !isVersion(heads)) {
    throw data("Event not found", { status: 404 });
  }
  setLocalUser(me);
  await Promise.all([
    documents.collection.preload(),
    teams.collection.preload(),
    events.collection.preload(),
    attendees.collection.preload(),
  ]);
  if (!documents.collection.has(id)) {
    throw data("Event not found", { status: 404 });
  }
  const handle = await openDraft<EventContent>(id).catch(() => {
    throw data(m.preview_open_failed(), { status: 500 });
  });
  return { id, handle, me, heads };
};

/** The page the draft would give when published, with the notice. */
export function Preview() {
  const { id, handle, me, heads } = useLoaderData<typeof previewLoader>();
  const version = useVersion(handle);
  const row = useLiveQuery({
    query: (q) =>
      q
        .from({ document: documents.collection })
        .where(({ document }) => eq(document.id, id))
        .findOne(),
  }).data;
  const team = useLiveQuery({
    query: (q) => q.from({ team: teams.collection }),
  }).data.find((candidate) => candidate.id === row?.teamId);
  const published = useLiveQuery({
    query: (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
  }).data;
  const signups = useSignups(id);
  // An earlier version shows once the local copy has those heads; it does
  // not follow the draft after that.
  const found = heads === null || A.hasHeads(handle.doc(), [...heads]);
  const following = heads === null ? version : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `following` stands for what the draft holds, and `heads` is set once by the loader
  const event = useMemo(() => {
    if (team === undefined || !found) return null;
    const draft =
      heads === null ? handle.doc() : A.clone(A.view(handle.doc(), [...heads]));
    const organizer: Organizer = {
      name: team.name,
      logo: team.logo,
      logoDark: team.logoDark,
    };
    return eventPreview({
      id,
      content: draft,
      body: A.spans(draft, ["body"]) as unknown as RichText,
      organizer,
    });
  }, [id, handle, following, team, found]);
  usePageTitle({ page: "event", title: event?.title ?? "" });
  // The draft was deleted while its preview was open.
  if (row === undefined || team === undefined) {
    return <p className={eventPageStyles.missing}>{m.site_event_missing()}</p>;
  }
  return (
    <div className={styles.preview}>
      {event === null ? (
        <p className={styles.needsTimes}>
          {found ? m.preview_needs_times() : m.preview_version_loading()}
        </p>
      ) : (
        <EventView
          event={event}
          signups={signups}
          signedIn
          email={me.email}
          linkGone={false}
          preview
        />
      )}
      <aside className={styles.notice}>
        <span>
          {heads === null ? m.preview_notice() : m.preview_version_notice()}
        </span>
        {published === undefined ? null : (
          <Link to={appPaths.event(id)}>{m.preview_view_published()}</Link>
        )}
      </aside>
    </div>
  );
}
