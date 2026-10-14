import * as A from "@automerge/automerge/slim";
import { type DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Field } from "../components/Field.tsx";
import { Shell } from "../components/Shell.tsx";
import { TextEditor } from "../editor/text/TextEditor.tsx";
import styles from "./Playground.module.css";

type Draft = {
  title: string;
  body: string;
};

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

/**
 * Two replicas of one document, in two in-memory repos. The link between
 * them can be cut to produce concurrent edits.
 */
function makeReplicas() {
  const repos = [new Repo(), new Repo()] as const;
  const first = repos[0].create<Draft>({ title: "", body: "" });
  // The same document, with its history, under the same id.
  const second = repos[1].import<Draft>(A.save(first.doc()), {
    docId: first.documentId,
  });
  return {
    repos,
    replicas: [
      { name: "Replica 1", handle: first },
      { name: "Replica 2", handle: second },
    ],
  };
}

export function Playground() {
  const [{ repos, replicas }] = useState(makeReplicas);
  const [connected, setConnected] = useState(true);

  // Connects the repos, which then sync on their own.
  useEffect(() => {
    if (!connected) return;
    const { port1, port2 } = new MessageChannel();
    const adapters = [
      new MessageChannelNetworkAdapter(port1),
      new MessageChannelNetworkAdapter(port2),
    ] as const;
    repos[0].networkSubsystem.addNetworkAdapter(adapters[0]);
    repos[1].networkSubsystem.addNetworkAdapter(adapters[1]);
    return () => {
      for (const adapter of adapters) adapter.disconnect();
    };
  }, [repos, connected]);

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
  readonly handle: DocHandle<Draft>;
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
