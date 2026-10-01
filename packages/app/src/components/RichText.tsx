import { type next as A, ImmutableString } from "@automerge/automerge/slim";
import { pmDocFromSpans } from "@automerge/prosemirror";
import type { RichText as Spans } from "@skjera/documents/api";
import type { Mark, Node } from "prosemirror-model";
import { type ReactNode, useMemo } from "react";
import { richTextAdapter } from "../editor/richText.ts";
import styles from "./RichText.module.css";

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
  try {
    const parsed = new URL(String(url), window.location.href);
    return protocols.includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
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
          href={safeUrl(mark.attrs["href"], ["http:", "https:", "mailto:"])}
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    default:
      return children;
  }
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
      return <p key={key}>{children()}</p>;
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
      const src = safeUrl(node.attrs["src"], ["http:", "https:"]);
      return src === undefined ? null : (
        <img
          key={key}
          src={src}
          alt={String(node.attrs["alt"] ?? "")}
          loading="lazy"
        />
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

/** Rich text as plain text, e.g. for an excerpt. */
export const plainText = (spans: Spans) => {
  const doc = toDoc(spans);
  return doc.textBetween(0, doc.content.size, " ", " ");
};
