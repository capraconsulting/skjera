import { type next as A, ImmutableString } from "@automerge/automerge/slim";
import { pmDocFromSpans } from "@automerge/prosemirror";
import {
  imageProtocols,
  linkProtocols,
  type RichText as Spans,
  safeLink,
} from "@skjera/documents/api";
import type { Mark, Node } from "prosemirror-model";
import { Fragment, type ReactNode, useMemo } from "react";
import {
  imageChoices,
  richTextAdapter,
  shownImage,
} from "../editor/text/richText.ts";
import styles from "./RichText.module.css";

export const richTextStyles = { content: styles.content };

// Published rich text, as React elements rather than HTML, so nothing in
// it runs as markup. Links and images keep only web addresses.

// Automerge marks block types as immutable strings, which JSON loses; the
// adapter takes other strings for paragraphs.
const revive = (spans: Spans): Array<A.Span> =>
  spans.map((span) => {
    if (span.type === "text") return span as A.Span;
    const { type, parents } = span.value;
    return {
      type: "block",
      value: {
        ...span.value,
        type: new ImmutableString(String(type)),
        parents: (Array.isArray(parents) ? parents : []).map(
          (parent) => new ImmutableString(String(parent)),
        ),
      },
    } as A.Span;
  });

const toDoc = (spans: Spans) => pmDocFromSpans(richTextAdapter, revive(spans));

/** Only web and mail links, and images from the web. */
const safeUrl = (url: unknown, protocols: ReadonlyArray<string>) => {
  return safeLink(url, window.location.href, protocols) ?? undefined;
};

const withMark = (mark: Mark, children: ReactNode, key: number) => {
  switch (mark.type.name) {
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "em":
      return <em key={key}>{children}</em>;
    case "code":
      return <code key={key}>{children}</code>;
    case "link":
      return (
        <a
          key={key}
          href={safeUrl(mark.attrs["href"], linkProtocols)}
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    default:
      return children;
  }
};

/** Whether the paragraph holds an image shown as a figure. */
const holdsFigure = (paragraph: Node) => {
  let found = false;
  paragraph.forEach((child) => {
    if (
      child.type.name === "image" &&
      imageChoices(child.attrs) !== null &&
      safeUrl(child.attrs["src"], imageProtocols) !== undefined
    ) {
      found = true;
    }
  });
  return found;
};

const render = (node: Node, key: number): ReactNode => {
  const children = () => {
    const list: Array<ReactNode> = [];
    node.forEach((child, _offset, index) => {
      list.push(render(child, index));
    });
    return list;
  };
  switch (node.type.name) {
    case "text":
      // Outermost mark first, like ProseMirror's own rendering.
      return node.marks.reduceRight<ReactNode>(
        (inner, mark, index) => withMark(mark, inner, index),
        node.text ?? "",
      );
    case "paragraph":
      // A figure is not allowed inside a <p>.
      return holdsFigure(node) ? (
        <div key={key} className={styles.paragraph}>
          {children()}
        </div>
      ) : (
        <p key={key}>{children()}</p>
      );
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs["level"]), 2), 4);
      const Heading = `h${level}` as "h2" | "h3" | "h4";
      return <Heading key={key}>{children()}</Heading>;
    }
    case "bullet_list":
      return <ul key={key}>{children()}</ul>;
    case "ordered_list":
      return (
        <ol key={key} start={Number(node.attrs["order"]) || 1}>
          {children()}
        </ol>
      );
    case "list_item":
      return <li key={key}>{children()}</li>;
    case "blockquote":
      return <blockquote key={key}>{children()}</blockquote>;
    case "code_block":
      return (
        <pre key={key}>
          <code>{children()}</code>
        </pre>
      );
    case "horizontal_rule":
      return <hr key={key} />;
    case "hard_break":
      return <br key={key} />;
    case "image": {
      const src = safeUrl(node.attrs["src"], imageProtocols);
      if (src === undefined) return null;
      const { alt, choices } = shownImage(node.attrs);
      const img = <img src={src} alt={alt} loading="lazy" />;
      // An image placed before there were choices keeps its look.
      if (choices === null) return <Fragment key={key}>{img}</Fragment>;
      return (
        <figure
          key={key}
          className={styles.figure}
          data-placement={choices.placement}
          data-size={choices.size}
        >
          {img}
          {choices.caption === "" ? null : (
            <figcaption>{choices.caption}</figcaption>
          )}
        </figure>
      );
    }
    default:
      // Anything else, e.g. an unknown block: its content, if any.
      return <div key={key}>{children()}</div>;
  }
};

/** Shows published rich text. */
export function RichText(props: { readonly spans: Spans }) {
  const content = useMemo(() => {
    const list: Array<ReactNode> = [];
    toDoc(props.spans).forEach((node, _offset, index) => {
      list.push(render(node, index));
    });
    return list;
  }, [props.spans]);
  return <div className={styles.content}>{content}</div>;
}
