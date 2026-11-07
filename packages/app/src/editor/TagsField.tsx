import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { type EventContent, tagLength } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useLiveQuery } from "@tanstack/react-db";
import { useCombobox } from "downshift";
import { useMemo, useState, useSyncExternalStore } from "react";
import fieldStyles from "../components/Field.module.css";
import inputStyles from "../components/Input.module.css";
import { tags as tagsTable } from "../sync/tables.ts";
import { sameTag, uniqueTags } from "../tags.ts";
import styles from "./TagsField.module.css";

// An event's tags: picked from tags published events have had, or new.
// Each is an Automerge ImmutableString in a list. Two people adding the
// same tag at once leave it twice; it shows and publishes once.

type Suggestion = { readonly name: string; readonly isNew: boolean };

const maxSuggestions = 8;

/** The draft's tags, without repeats, updated as they change. */
const useTags = (handle: DocHandle<EventContent>) => {
  const key = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => JSON.stringify((handle.doc().tags ?? []).map(String)),
  );
  return useMemo(() => uniqueTags(JSON.parse(key) as Array<string>), [key]);
};

export function TagsField(props: { readonly handle: DocHandle<EventContent> }) {
  const { handle } = props;
  const tags = useTags(handle);
  const known = useLiveQuery((q) => q.from({ tag: tagsTable.collection })).data;
  const [input, setInput] = useState("");
  const typed = input.trim().replace(/\s+/g, " ");

  const suggestions = useMemo((): ReadonlyArray<Suggestion> => {
    const needle = typed.toLowerCase();
    const matches = uniqueTags(known.map((tag) => tag.name))
      .filter(
        (name) =>
          name.toLowerCase().includes(needle) &&
          !tags.some((tag) => sameTag(tag, name)),
      )
      // Those starting with what's typed first.
      .sort(
        (a, b) =>
          Number(!a.toLowerCase().startsWith(needle)) -
            Number(!b.toLowerCase().startsWith(needle)) || a.localeCompare(b),
      )
      .slice(0, maxSuggestions)
      .map((name) => ({ name, isNew: false }));
    const isNew =
      typed !== "" &&
      !matches.some((match) => sameTag(match.name, typed)) &&
      !tags.some((tag) => sameTag(tag, typed));
    return isNew ? [{ name: typed, isNew: true }, ...matches] : matches;
  }, [known, tags, typed]);

  const add = (name: string) =>
    handle.change((doc) => {
      const list = (doc as unknown as { tags: Array<unknown> }).tags;
      if (!list.some((tag) => sameTag(String(tag), name))) {
        list.push(new A.ImmutableString(name));
      }
    });

  const remove = (name: string) =>
    handle.change((doc) => {
      const list = (doc as unknown as { tags: Array<unknown> }).tags;
      // Every copy, if it was added twice at once.
      for (let index = list.length - 1; index >= 0; index--) {
        if (sameTag(String(list[index]), name)) list.splice(index, 1);
      }
    });

  const {
    isOpen,
    highlightedIndex,
    getInputProps,
    getItemProps,
    getMenuProps,
    getLabelProps,
    openMenu,
  } = useCombobox<Suggestion>({
    items: [...suggestions],
    itemToString: (item) => item?.name ?? "",
    inputValue: input,
    selectedItem: null,
    defaultHighlightedIndex: 0,
    stateReducer: (state, { type, changes }) => {
      switch (type) {
        // Picking one keeps the list open for the next.
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          return { ...changes, isOpen: true, inputValue: "" };
        // Leaving doesn't add what was typed.
        case useCombobox.stateChangeTypes.InputBlur:
          return {
            ...changes,
            selectedItem: null,
            inputValue: state.inputValue,
          };
        default:
          return changes;
      }
    },
    onStateChange: ({ type, selectedItem, inputValue }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          if (selectedItem) {
            add(selectedItem.name);
            setInput("");
          }
          break;
        case useCombobox.stateChangeTypes.InputChange:
          setInput(inputValue ?? "");
          break;
      }
    },
  });

  return (
    <div className={fieldStyles.field}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Downshift ties it to the input. */}
      <label className={fieldStyles.label} {...getLabelProps()}>
        {m.site_tags()}
      </label>
      {tags.length === 0 ? null : (
        <ul className={styles.tags} aria-label={m.editor_tags_on_event()}>
          {tags.map((tag) => (
            <li key={tag.toLowerCase()} className={styles.pill}>
              {tag}
              <button
                type="button"
                className={styles.remove}
                aria-label={m.editor_remove_tag({ tag })}
                onClick={() => remove(tag)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.combobox}>
        <input
          className={inputStyles.input}
          placeholder={m.editor_tag_placeholder()}
          maxLength={tagLength}
          {...getInputProps({ onFocus: () => openMenu() })}
        />
        <ul
          className={styles.menu}
          {...getMenuProps()}
          hidden={!(isOpen && suggestions.length > 0)}
        >
          {isOpen
            ? suggestions.map((item, index) => (
                <li
                  key={`${item.isNew}-${item.name}`}
                  className={
                    index === highlightedIndex
                      ? `${styles.option} ${styles.highlighted}`
                      : styles.option
                  }
                  {...getItemProps({ item, index })}
                >
                  {item.isNew ? (
                    <span className={`${styles.pill} ${styles.new}`}>
                      <span aria-hidden="true">+</span> {item.name}
                      <span className={styles.hidden}>
                        {" "}
                        {m.editor_new_tag()}
                      </span>
                    </span>
                  ) : (
                    item.name
                  )}
                </li>
              ))
            : null}
        </ul>
      </div>
    </div>
  );
}
