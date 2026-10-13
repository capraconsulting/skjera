/** @jsxRuntime automatic @jsxImportSource react */
import { type next as A, ImmutableString } from "@automerge/automerge/slim";
import { basicSchemaAdapter, pmDocFromSpans } from "@automerge/prosemirror";
import type { Mark, Node } from "prosemirror-model";
import type { ReactNode } from "react";
import { Text } from "react-email";
import type { RichText as Spans } from "../Model.ts";
import { paragraph } from "./Layout.tsx";

// An organiser's own text for an email: published rich text as email
// elements. Nothing in it runs as markup; links keep only web and mail
// addresses, images only web addresses, both on the site's address.

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

const toDoc = (spans: Spans) =>
  pmDocFromSpans(basicSchemaAdapter, revive(spans));

/** The text as plain text, for the inbox preview. */
export const plainText = (spans: Spans) => {
  const doc = toDoc(spans);
  return doc.textBetween(0, doc.content.size, " ", " ");
};

/** Only web and mail links, and images from the web, on the site. */
const safeUrl = (
  url: unknown,
  site: string,
  protocols: ReadonlyArray<string>,
) => {
  try {
    const parsed = new URL(String(url), site);
    return protocols.includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};

const blockStyle = { ...paragraph };
const headingStyle = { margin: "0 0 12px", lineHeight: "1.3" };
const headingSizes = { 2: "20px", 3: "17px", 4: "15px" } as const;
const listStyle = { ...paragraph, paddingLeft: "24px" };
const quoteStyle = {
  ...paragraph,
  paddingLeft: "12px",
  borderLeft: "3px solid #e4e4e0",
  color: "#6b6f76",
};
const codeStyle = {
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: "13px",
};
const blockCodeStyle = {
  ...codeStyle,
  margin: "0 0 16px",
  padding: "12px",
  backgroundColor: "#f6f6f4",
  borderRadius: "6px",
  whiteSpace: "pre-wrap" as const,
};

const withMark = (
  mark: Mark,
  children: ReactNode,
  key: number,
  site: string,
) => {
  switch (mark.type.name) {
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "em":
      return <em key={key}>{children}</em>;
    case "code":
      return (
        <code key={key} style={codeStyle}>
          {children}
        </code>
      );
    case "link":
      return (
        <a
          key={key}
          href={safeUrl(mark.attrs["href"], site, [
            "http:",
            "https:",
            "mailto:",
          ])}
          style={{ color: "inherit" }}
        >
          {children}
        </a>
      );
    default:
      return children;
  }
};

const render = (node: Node, key: number, site: string): ReactNode => {
  const children = () => {
    const list: Array<ReactNode> = [];
    node.forEach((child, _offset, index) => {
      list.push(render(child, index, site));
    });
    return list;
  };
  switch (node.type.name) {
    case "text":
      // Outermost mark first, like ProseMirror's own rendering.
      return node.marks.reduceRight<ReactNode>(
        (inner, mark, index) => withMark(mark, inner, index, site),
        node.text ?? "",
      );
    case "paragraph":
      return (
        <Text key={key} style={blockStyle}>
          {children()}
        </Text>
      );
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs["level"]), 2), 4) as
        | 2
        | 3
        | 4;
      const Heading = `h${level}` as "h2" | "h3" | "h4";
      return (
        <Heading
          key={key}
          style={{ ...headingStyle, fontSize: headingSizes[level] }}
        >
          {children()}
        </Heading>
      );
    }
    case "bullet_list":
      return (
        <ul key={key} style={listStyle}>
          {children()}
        </ul>
      );
    case "ordered_list":
      return (
        <ol
          key={key}
          start={Number(node.attrs["order"]) || 1}
          style={listStyle}
        >
          {children()}
        </ol>
      );
    case "list_item":
      return <li key={key}>{children()}</li>;
    case "blockquote":
      return (
        <blockquote key={key} style={quoteStyle}>
          {children()}
        </blockquote>
      );
    case "code_block":
      return (
        <pre key={key} style={blockCodeStyle}>
          <code>{children()}</code>
        </pre>
      );
    case "horizontal_rule":
      return (
        <hr
          key={key}
          style={{
            margin: "16px 0",
            border: 0,
            borderTop: "1px solid #e4e4e0",
          }}
        />
      );
    case "hard_break":
      return <br key={key} />;
    case "image": {
      const src = safeUrl(node.attrs["src"], site, ["http:", "https:"]);
      return src === undefined ? null : (
        <img
          key={key}
          src={src}
          alt={String(node.attrs["alt"] ?? "")}
          style={{ maxWidth: "100%", height: "auto" }}
        />
      );
    }
    default:
      // Anything else, e.g. an unknown block: its content, if any.
      return <div key={key}>{children()}</div>;
  }
};

/** An organiser's text, as the body of an email. */
export function OrganizerText(props: {
  readonly spans: Spans;
  /** The site's address: relative links and images are on it. */
  readonly site: string;
}) {
  const content: Array<ReactNode> = [];
  toDoc(props.spans).forEach((node, _offset, index) => {
    content.push(render(node, index, props.site));
  });
  return <>{content}</>;
}

/** What an email shows in place of its standard opening: the organiser's text. */
export interface WrittenText {
  readonly spans: Spans;
  /** The site's address. */
  readonly site: string;
  /** Where the event is; null: published before events had a place. */
  readonly place: string | null;
}

/** The event after the organiser's text: its title, time and place. */
export function EventDetails(props: {
  readonly title: string;
  /** When, written out (see format.ts). */
  readonly when: string;
  readonly place: string | null;
}) {
  return (
    <Text style={paragraph}>
      <strong>{props.title}</strong>
      <br />
      {props.when}
      {props.place === null ? null : (
        <>
          <br />
          {props.place}
        </>
      )}
    </Text>
  );
}
