import { Fragment, type ReactNode } from "react";
import type { SafeNode } from "@iz/schema";

/**
 * React renderer for the safe document AST (§10.6). World Markdown reaches
 * the client ONLY in this compiled, allowlisted shape; text values are
 * rendered through React and are therefore escaped — nothing here is
 * dangerous HTML.
 *
 * Safety rules enforced here:
 * - Links NEVER navigate the real browser. They call onOpenLink(url) so the
 *   in-game browser routes them (§10.1); the href is inert.
 * - Images are asset references; asset serving is not wired yet, so we render
 *   an accessible placeholder box instead of an <img> (documented limitation).
 * - Redactions: non-removable redactions always render as an opaque bar and
 *   their text is never placed in the DOM; removable ones reveal their text
 *   only when `inspectLayers` is true (the "inspect layers" tool, §10.3).
 */

export interface SafeAstProps {
  node: SafeNode;
  /** When true, removable redactions reveal their hidden text. */
  inspectLayers?: boolean;
  /** Called for in-game links instead of any real navigation. */
  onOpenLink?: (url: string) => void;
}

export function SafeAst({ node, inspectLayers = false, onOpenLink }: SafeAstProps): ReactNode {
  return <>{renderNode(node, inspectLayers, onOpenLink)}</>;
}

function renderNode(node: SafeNode, inspect: boolean, onOpen: SafeAstProps["onOpenLink"]): ReactNode {
  switch (node.type) {
    case "root":
      return <Fragment>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</Fragment>;

    case "paragraph":
      return <p>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</p>;

    case "heading": {
      const Tag = `h${node.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</Tag>;
    }

    case "text":
      return node.value;

    case "emphasis":
      return <em>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</em>;

    case "strong":
      return <strong>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</strong>;

    case "inlineCode":
      return <code>{node.value}</code>;

    case "code":
      return (
        <pre>
          <code data-lang={node.lang}>{node.value}</code>
        </pre>
      );

    case "list": {
      const items = node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>);
      return node.ordered ? <ol start={node.start}>{items}</ol> : <ul>{items}</ul>;
    }

    case "listItem":
      return (
        <li>
          {node.children.map((child, i) => (
            <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>
          ))}
        </li>
      );

    case "blockquote":
      return <blockquote>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</blockquote>;

    case "table":
      return <table><tbody>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</tbody></table>;

    case "tableRow":
      return <tr>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</tr>;

    case "tableCell":
      return <td>{node.children.map((child, i) => <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>)}</td>;

    case "break":
      return <br />;

    case "link": {
      // In-game link: never navigates. Rendered as an anchor for semantics and
      // keyboard behaviour; the click handler always prevents default.
      return (
        <a
          href="#"
          title={node.title ?? node.url}
          onClick={(event) => {
            event.preventDefault();
            onOpen?.(node.url);
          }}
        >
          {node.children.map((child, i) => (
            <Fragment key={i}>{renderNode(child, inspect, onOpen)}</Fragment>
          ))}
        </a>
      );
    }

    case "image":
      return /^[0-9a-f]{64}$/.test(node.url)
        ? <img src={`/api/assets/${node.url}`} alt={node.alt ?? ''} title={node.title} loading="lazy" />
        : <span className="iz-img-placeholder" role="img" aria-label={node.alt ?? "image"}><ImageGlyph />{node.alt ?? 'image unavailable'}</span>;

    case "redaction": {
      if (node.removable && inspect) {
        return (
          <span className="iz-redaction iz-redaction--revealed" data-redaction="removable">
            {node.text}
          </span>
        );
      }
      // The hidden text of a redaction never enters the DOM unless revealed.
      return (
        <span
          className="iz-redaction"
          data-redaction={node.removable ? "removable-hidden" : "fixed"}
          aria-label="redacted"
          role="img"
        />
      );
    }

    case "signature":
      return (
        <span className={`iz-signature${node.valid ? "" : " iz-signature--invalid"}`}>
          <span className="iz-signature__name">{node.signer}</span>{" "}
          <span>
            key {node.keyId} · fp {node.fingerprint}
          </span>{" "}
          <span>{node.valid ? "signature valid" : "signature INVALID"}</span>
        </span>
      );

    case "stamp":
      return <span className="iz-stamp">{node.text}</span>;
  }
}

function ImageGlyph(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <circle cx="5.5" cy="6" r="1.3" />
      <path d="M2 12.5 6.5 8.5l3 3 2-2 2.5 2.5" />
    </svg>
  );
}
