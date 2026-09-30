import * as A from "@automerge/automerge/slim";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Field } from "../components/Field.tsx";
import { Shell } from "../components/Shell.tsx";
import { LocalDocHandle } from "../editor/LocalDocHandle.ts";
import { TextEditor } from "../editor/TextEditor.tsx";
import styles from "./Playground.module.css";

type Draft = {
  title: string;
  body: string;
};

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

/**
 * Two replicas of one event, each with its own actor id, kept in sync by a
 * simulated network link that can be paused to produce concurrent edits.
 */
function makeReplicas() {
  const original = A.from<Draft>({ title: "", body: "" });
  // Loading a save gives the second replica its own random actor id.
  const other = A.load<Draft>(A.save(original));
  return [
    { name: "Replica 1", handle: new LocalDocHandle(original), sent: original },
    { name: "Replica 2", handle: new LocalDocHandle(other), sent: other },
  ];
}

const syncIntervalMs = 250;

export function Playground() {
  const [replicas] = useState(makeReplicas);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    if (!connected) return;
    // Send each replica's changes since its last sync to the other one.
    // Changes the receiver already has are ignored by Automerge.
    const sync = () => {
      for (const [index, from] of replicas.entries()) {
        const to = replicas[1 - index];
        if (to === undefined) continue;
        const current = from.handle.doc();
        const changes = A.getChanges(from.sent, current);
        from.sent = current;
        to.handle.applyChanges(changes);
      }
    };
    sync();
    const timer = setInterval(sync, syncIntervalMs);
    return () => clearInterval(timer);
  }, [replicas, connected]);

  return (
    <Shell>
      <h1>Playground</h1>
      <label>
        <input
          type="checkbox"
          checked={connected}
          onChange={(event) => setConnected(event.target.checked)}
        />{" "}
        Replicas connected
      </label>
      <div className={styles.replicas}>
        {replicas.map(({ name, handle }) => (
          <Replica key={name} name={name} handle={handle} />
        ))}
      </div>
    </Shell>
  );
}

function Replica({
  name,
  handle,
}: {
  readonly name: string;
  readonly handle: LocalDocHandle<Draft>;
}) {
  const doc = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => handle.doc(),
  );

  return (
    <section data-testid={name}>
      <h2>{name}</h2>
      <Field label="Title">
        <TextEditor handle={handle} path={titlePath} label={`${name} title`} />
      </Field>
      <Field label="Body">
        <TextEditor
          handle={handle}
          path={bodyPath}
          label={`${name} body`}
          multiline
        />
      </Field>
      <pre className={styles.json} data-testid={`${name} json`}>
        {JSON.stringify(doc)}
      </pre>
    </section>
  );
}
