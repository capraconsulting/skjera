import { m } from "@skjera/i18n/messages";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog, dialogStyles } from "../../components/Dialog.tsx";
import { Input } from "../../components/Input.tsx";
import { ImagePicker } from "../ImagePicker.tsx";
import { acceptedImages, uploadImage } from "../uploadImage.ts";
import { ImageChoiceFields, readChoices } from "./ImageChoiceFields.tsx";
import styles from "./RichTextToolbar.module.css";
import {
  choicesToStore,
  defaultChoices,
  type ImageChoices,
  insertImage,
  safeHref,
  setImage,
  setLink,
  toolbarState,
} from "./richText.ts";

/** Formatting for a rich text editor, following its selection. */
export function RichTextToolbar(props: {
  readonly view: EditorView;
  /** The editor's label, e.g. "Body", to name the toolbar. */
  readonly label: string;
  /** Whether an image has a caption, placement and size to choose. */
  readonly imageChoices?: boolean;
}) {
  const { view } = props;
  const tools = toolbarState(view.state);
  const [linking, setLinking] = useState(false);
  const [addingImage, setAddingImage] = useState(false);
  const [describing, setDescribing] = useState(false);

  const run = (command: Command) => {
    command(view.state, view.dispatch);
    view.focus();
  };

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label={m.editor_formatting({ field: props.label })}
    >
      <Tool
        label={m.editor_bold()}
        active={tools.bold.active}
        onClick={() => run(tools.bold.run)}
      >
        <b>B</b>
      </Tool>
      <Tool
        label={m.editor_italic()}
        active={tools.italic.active}
        onClick={() => run(tools.italic.run)}
      >
        <i>I</i>
      </Tool>
      <span className={styles.separator} aria-hidden="true" />
      <Tool
        label={m.editor_heading()}
        active={tools.heading.active}
        onClick={() => run(tools.heading.run)}
      >
        H
      </Tool>
      <Tool
        label={m.editor_bullets()}
        active={tools.bulletList.active}
        onClick={() => run(tools.bulletList.run)}
      >
        •
      </Tool>
      <Tool
        label={m.editor_numbers()}
        active={tools.orderedList.active}
        onClick={() => run(tools.orderedList.run)}
      >
        1.
      </Tool>
      <span className={styles.separator} aria-hidden="true" />
      <Tool
        label={m.editor_link()}
        active={tools.link.active}
        disabled={!tools.link.available}
        onClick={() => setLinking(true)}
      >
        {m.editor_link()}
      </Tool>
      <LinkDialog
        open={linking}
        href={tools.link.href}
        onClose={() => {
          setLinking(false);
          view.focus();
        }}
        onLink={(href) => {
          setLinking(false);
          run(setLink(href));
        }}
      />
      <Tool label={m.editor_image()} onClick={() => setAddingImage(true)}>
        {m.editor_image()}
      </Tool>
      <ImageDialog
        open={addingImage}
        choices={props.imageChoices === true}
        onClose={() => {
          setAddingImage(false);
          view.focus();
        }}
        onImage={(src, alt, choices) => {
          setAddingImage(false);
          run(insertImage(src, alt, choices));
        }}
      />
      {tools.image === null ? null : (
        <Tool
          label={m.editor_alt_text_tool()}
          onClick={() => setDescribing(true)}
        >
          {m.editor_alt_text()}
        </Tool>
      )}
      <DescribeImageDialog
        open={describing}
        alt={tools.image?.alt ?? ""}
        choices={
          props.imageChoices === true
            ? (tools.image?.choices ?? defaultChoices)
            : null
        }
        onClose={() => {
          setDescribing(false);
          view.focus();
        }}
        onDescribe={(alt, chosen) => {
          setDescribing(false);
          const stored = tools.image?.stored ? tools.image.choices : null;
          run(
            setImage(
              alt,
              chosen === null ? null : choicesToStore(stored, chosen),
            ),
          );
        }}
      />
    </div>
  );
}

function Tool(props: {
  readonly label: string;
  /** Whether it is on, for tools that toggle. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.tool}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      // Keep the selection in the editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Asks where a link should go; web and mail addresses only. */
function LinkDialog(props: {
  readonly open: boolean;
  readonly href: string | null;
  readonly onClose: () => void;
  /** null removes the link. */
  readonly onLink: (href: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("href") ?? "");
    const href = safeHref(value.trim());
    if (href === null) {
      setError(m.editor_link_invalid());
      return;
    }
    setError(null);
    props.onLink(href);
  };

  return (
    <Dialog
      open={props.open}
      title={props.href === null ? m.editor_add_link() : m.editor_edit_link()}
      onClose={() => {
        setError(null);
        props.onClose();
      }}
    >
      <form onSubmit={submit}>
        <Input
          name="href"
          type="url"
          aria-label={m.editor_link_address()}
          placeholder="https://"
          className={dialogStyles.input}
          defaultValue={props.href ?? ""}
          required
          autoFocus
        />
        {error === null ? null : (
          <p role="alert" className={dialogStyles.error}>
            {error}
          </p>
        )}
        <div className={dialogStyles.actions}>
          {props.href === null ? null : (
            <Button variant="danger" onClick={() => props.onLink(null)}>
              {m.editor_remove_link()}
            </Button>
          )}
          <Button onClick={props.onClose}>{m.common_cancel()}</Button>
          <Button type="submit" variant="primary">
            {props.href === null ? m.editor_add_link() : m.editor_save_link()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Adds an image, uploaded or picked from those already in Skjera, with a
 * description for those who can't see it.
 */
function ImageDialog(props: {
  readonly open: boolean;
  /** Whether the caption, placement and size are asked for. */
  readonly choices: boolean;
  readonly onClose: () => void;
  readonly onImage: (
    src: string,
    alt: string,
    choices: ImageChoices | undefined,
  ) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Where the image picked from the list is served: it is added in place of
  // a file, and a file chosen after it takes its place.
  const [picked, setPicked] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const close = () => {
    setError(null);
    setPicked(null);
    props.onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setUploading(true);
    try {
      const file = data.get("image");
      if (picked === null && (!(file instanceof File) || file.size === 0)) {
        throw new Error(m.editor_pick_image());
      }
      const src =
        picked ?? (file instanceof File ? await uploadImage(file) : "");
      setError(null);
      setPicked(null);
      props.onImage(
        src,
        String(data.get("alt") ?? "").trim(),
        props.choices ? readChoices(data) : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Dialog open={props.open} title={m.editor_add_image()} onClose={close}>
        <form ref={form} onSubmit={submit}>
          <Input
            name="image"
            type="file"
            accept={acceptedImages}
            aria-label={m.editor_image_file()}
            className={dialogStyles.input}
            required={picked === null}
            onChange={() => setPicked(null)}
            autoFocus
          />
          <div className={styles.existing}>
            <Button onClick={() => setPicking(true)}>
              {m.editor_existing_pick()}
            </Button>
            {picked === null ? null : (
              <img className={styles.picked} src={picked} alt="" />
            )}
          </div>
          <Input
            name="alt"
            aria-label={m.editor_description()}
            placeholder={m.editor_describe_placeholder()}
            className={`${dialogStyles.input} ${styles.description}`}
          />
          {props.choices ? (
            <ImageChoiceFields choices={defaultChoices} />
          ) : null}
          {error === null ? null : (
            <p role="alert" className={dialogStyles.error}>
              {error}
            </p>
          )}
          <div className={dialogStyles.actions}>
            <Button onClick={close}>{m.common_cancel()}</Button>
            <Button type="submit" variant="primary" disabled={uploading}>
              {uploading ? m.editor_uploading() : m.editor_add_image()}
            </Button>
          </div>
        </form>
      </Dialog>
      {/* Beside the Image dialog, not inside it: a dialog's close event
          reaches the onClose of every dialog around it. */}
      <ImagePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(url) => {
          setPicked(url);
          const file = form.current?.elements.namedItem("image");
          if (file instanceof HTMLInputElement) file.value = "";
        }}
      />
    </>
  );
}

/** What an image shows, for those who can't see it, and how it is placed. */
function DescribeImageDialog(props: {
  readonly open: boolean;
  readonly alt: string;
  /** The image's choices to show; null when it has none to choose. */
  readonly choices: ImageChoices | null;
  readonly onClose: () => void;
  readonly onDescribe: (alt: string, choices: ImageChoices | null) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    props.onDescribe(
      String(form.get("alt") ?? "").trim(),
      props.choices === null ? null : readChoices(form),
    );
  };
  return (
    <Dialog
      open={props.open}
      title={m.editor_describe_image()}
      onClose={props.onClose}
    >
      <form onSubmit={submit}>
        <Input
          name="alt"
          aria-label={m.editor_description()}
          placeholder={m.editor_describe_placeholder()}
          className={dialogStyles.input}
          defaultValue={props.alt}
          autoFocus
        />
        {props.choices === null ? null : (
          <ImageChoiceFields choices={props.choices} />
        )}
        <div className={dialogStyles.actions}>
          <Button onClick={props.onClose}>{m.common_cancel()}</Button>
          <Button type="submit" variant="primary">
            {m.common_save()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
