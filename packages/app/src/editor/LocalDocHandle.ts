import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/prosemirror";

type Listener<T> = Parameters<DocHandle<T>["on"]>[1];

/**
 * The minimal handle @automerge/prosemirror needs, without automerge-repo:
 * holds the current document and tells listeners about every change, local
 * or received from elsewhere.
 */
export class LocalDocHandle<T> implements DocHandle<T> {
  #doc: A.Doc<T>;
  readonly #listeners = new Set<Listener<T>>();
  readonly #onLocalChange: ((change: A.Change) => void) | undefined;

  /** `onLocalChange` receives each change made through this handle, to send. */
  constructor(
    doc: A.Doc<T>,
    options?: { readonly onLocalChange?: (change: A.Change) => void },
  ) {
    this.#doc = doc;
    this.#onLocalChange = options?.onLocalChange;
  }

  doc(): A.Doc<T> {
    return this.#doc;
  }

  change = (fn: (doc: T) => void): void => {
    const before = this.#doc;
    this.#update((patchCallback) => A.change(this.#doc, { patchCallback }, fn));
    const change =
      this.#doc === before ? undefined : A.getLastLocalChange(this.#doc);
    if (change !== undefined) {
      this.#onLocalChange?.(change);
    }
  };

  /** Applies changes made by another replica. */
  applyChanges(changes: ReadonlyArray<A.Change>): void {
    if (changes.length === 0) return;
    this.#update(
      (patchCallback) =>
        A.applyChanges(this.#doc, [...changes], { patchCallback })[0],
    );
  }

  /** Applies a save or change chunks from elsewhere, e.g. the server. */
  applyIncremental(data: Uint8Array): void {
    this.#update((patchCallback) =>
      A.loadIncremental(this.#doc, data, { patchCallback }),
    );
  }

  on(_event: "change", callback: Listener<T>): void {
    this.#listeners.add(callback);
  }

  off(_event: "change", callback: Listener<T>): void {
    this.#listeners.delete(callback);
  }

  #update(run: (patchCallback: A.PatchCallback<T>) => A.Doc<T>): void {
    let captured:
      | { patches: Array<A.Patch>; patchInfo: A.PatchInfo<T> }
      | undefined;
    const next = run((patches, patchInfo) => {
      captured = { patches, patchInfo };
    });
    // Listeners may read handle.doc(), so update it before notifying.
    this.#doc = next;
    if (captured === undefined || captured.patches.length === 0) return;
    for (const listener of this.#listeners) {
      listener({ handle: this, doc: next, ...captured });
    }
  }
}
