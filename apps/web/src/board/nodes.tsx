import type { ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useArtifactTitle } from "../notebook/titles.js";

/**
 * Custom node components (§11.2): evidence renders as a document card with a
 * source host+path chip; claims render as sticky notes — so the board shows
 * the difference between what was found and what is inferred (§7).
 */

export interface DocumentNodeData extends Record<string, unknown> {
  artifactId: string;
  host: string;
  path: string;
  service: string;
  fragmentLabel?: string;
  /** Board-local link mode markers (presentation only). */
  linkingSource?: boolean;
  linkingTarget?: boolean;
}

export type DocumentNodeType = Node<DocumentNodeData, "document">;

export interface NoteNodeData extends Record<string, unknown> {
  text: string;
  isPrivate: boolean;
  linkingSource?: boolean;
  linkingTarget?: boolean;
}

export type NoteNodeType = Node<NoteNodeData, "note">;

export type BoardNode = DocumentNodeType | NoteNodeType;

export function DocumentCardNode({ id, data }: NodeProps<DocumentNodeType>): ReactNode {
  // Titles resolve through the notebook's per-session view cache; until (and
  // unless) a title arrives the card shows the source host+path.
  const title = useArtifactTitle(data.host, data.path, data.artifactId);
  const source = `${data.host}${data.path}`;
  const classes = [
    "iz-bd__doc",
    data.linkingSource === true ? "iz-bd__doc--source" : "",
    data.linkingTarget === true ? "iz-bd__node--target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-testid={`board-node-${id}`} aria-label={`Evidence: ${title ?? source}`}>
      <Handle type="target" position={Position.Left} className="iz-bd__handle" isConnectable />
      <p className="iz-bd__node-kind">Evidence</p>
      <h3 className="iz-bd__node-title">{title ?? (source !== "" ? source : data.artifactId)}</h3>
      <p className="iz-bd__node-chips">
        {data.service !== "" && <span className="iz-chip">{data.service}</span>}
        {source !== "" && <span className="iz-chip">{source}</span>}
        {data.fragmentLabel !== undefined && <span className="iz-chip">{data.fragmentLabel}</span>}
      </p>
      <Handle type="source" position={Position.Right} className="iz-bd__handle" isConnectable />
    </article>
  );
}

export function NoteNode({ id, data }: NodeProps<NoteNodeType>): ReactNode {
  const classes = [
    "iz-bd__note",
    data.isPrivate ? "iz-bd__note--private" : "",
    data.linkingSource === true ? "iz-bd__doc--source" : "",
    data.linkingTarget === true ? "iz-bd__node--target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-testid={`board-node-${id}`} aria-label={`Claim: ${data.text}`}>
      <Handle type="target" position={Position.Left} className="iz-bd__handle" isConnectable />
      <p className="iz-bd__node-kind">{data.isPrivate ? "Claim · private" : "Claim"}</p>
      <p className="iz-bd__note-text">{data.text}</p>
      <Handle type="source" position={Position.Right} className="iz-bd__handle" isConnectable />
    </article>
  );
}
