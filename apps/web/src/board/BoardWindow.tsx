import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import type { Claim, Confidence, EvidenceItem, LinkRelation } from "@iz/schema";
import { announce, useSessionStore } from "@iz/ui";
import { layeredLayout } from "./layout.js";
import { useBoardPositions } from "./positions.js";
import {
  DocumentCardNode,
  NoteNode,
  type BoardNode,
  type DocumentNodeData,
  type NoteNodeData,
} from "./nodes.js";
import "./board.css";

/**
 * The evidence board (§11.2): a React Flow canvas over the team's evidence
 * and claims. The session store is the only source of truth for WHICH items
 * and links exist; node positions are presentation state persisted locally
 * (iz.board.v1). All mutations dispatch actions: link via the keyboard flow
 * (select a node, press L, arrows + Enter, then relation + confidence), unlink
 * via Delete on a selected edge. Archived evidence never renders (§7).
 */

export interface BoardWindowProps {
  /**
   * Integrator wiring for Enter ("open item"): route to the notebook pane.
   * Default behavior opens a read-only details pane inside the board.
   */
  onOpenItem?: (ref: { id: string; kind: "evidence" | "claim" }) => void;
}

const RELATIONS: readonly LinkRelation[] = [
  "supports",
  "contradicts",
  "same_identity",
  "precedes",
  "derived_from",
];

const NODE_TYPES: NodeTypes = { document: DocumentCardNode, note: NoteNode };

const RELATION_SENTENCE: Record<LinkRelation, string> = {
  supports: "supports",
  contradicts: "contradicts",
  same_identity: "is the same as",
  precedes: "precedes",
  derived_from: "is derived from",
};

function confidenceDots(confidence: Confidence): string {
  return `${"●".repeat(confidence)}${"○".repeat(3 - confidence)}`;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fragmentLabel(item: EvidenceItem): string | undefined {
  const fragment = item.fragment;
  if (fragment === undefined) return undefined;
  switch (fragment.kind) {
    case "lines":
      return `lines ${fragment.from}–${fragment.to}`;
    case "range":
      return `chars ${fragment.start}–${fragment.end}`;
    case "region":
      return "image region";
  }
}

type NodeSpec = { kind: "evidence"; item: EvidenceItem } | { kind: "claim"; item: Claim };

function shortLabel(spec: NodeSpec | undefined): string {
  if (spec === undefined) return "?";
  if (spec.kind === "claim") {
    const text = spec.item.text;
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  const source = `${spec.item.provenance.host}${spec.item.provenance.path}`;
  return source !== "" ? source : spec.item.artifactId;
}

function detailLabel(spec: NodeSpec | undefined): string {
  if (spec === undefined) return "?";
  return spec.kind === "claim" ? spec.item.text : shortLabel(spec);
}

function defaultPosition(index: number): { x: number; y: number } {
  return { x: (index % 4) * 240, y: Math.floor(index / 4) * 180 };
}

function BoardCanvas({ onOpenItem }: BoardWindowProps): ReactNode {
  const evidence = useSessionStore((s) => s.state?.evidence);
  const claims = useSessionStore((s) => s.state?.claims);
  const links = useSessionStore((s) => s.state?.links);
  const dispatch = useSessionStore((s) => s.dispatch);
  const { fitView } = useReactFlow();

  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>(undefined);
  /** Link mode stage 1: source picked, choosing a target with arrows. */
  const [linkFrom, setLinkFrom] = useState<string | undefined>(undefined);
  const [targetIndex, setTargetIndex] = useState(0);
  /** Link mode stage 2: relation + confidence modal open. */
  const [draft, setDraft] = useState<
    { from: string; to: string; relation: LinkRelation; confidence: Confidence } | undefined
  >(undefined);
  const [details, setDetails] = useState<{ id: string; kind: "evidence" | "claim" } | undefined>(
    undefined
  );

  const linkList = useMemo(() => Object.values(links ?? {}), [links]);

  /** Deterministic order: evidence then claims, oldest first (board order). */
  const specs = useMemo(() => {
    const map = new Map<string, NodeSpec>();
    for (const item of Object.values(evidence ?? {})) {
      if (!item.archived) map.set(item.id, { kind: "evidence", item });
    }
    for (const claim of Object.values(claims ?? {})) map.set(claim.id, { kind: "claim", item: claim });
    return map;
  }, [evidence, claims]);

  const evidenceOrder = useMemo(
    () =>
      Object.values(evidence ?? {})
        .filter((e) => !e.archived)
        .map((e) => ({ id: e.id, at: e.collectedAt }))
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
        .map((entry) => entry.id),
    [evidence]
  );
  const claimOrder = useMemo(
    () =>
      Object.values(claims ?? {})
        .map((c) => ({ id: c.id, at: c.createdAt }))
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
        .map((entry) => entry.id),
    [claims]
  );
  const order = useMemo(() => [...evidenceOrder, ...claimOrder], [evidenceOrder, claimOrder]);

  /** Link-mode target cursor walks every node except the source. */
  const targetOrder = useMemo(
    () => order.filter((id) => id !== linkFrom),
    [order, linkFrom]
  );
  const targetId = targetOrder[targetIndex];

  // Keep nodes in step with the session store: preserve dragged positions and
  // selection, refresh data (claim edits), add new items, drop removed ones.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      const positions = useBoardPositions.getState().positions;
      const next: BoardNode[] = [];
      let index = 0;
      for (const id of order) {
        const spec = specs.get(id);
        if (spec === undefined) continue;
        const data: DocumentNodeData | NoteNodeData =
          spec.kind === "evidence"
            ? {
                artifactId: spec.item.artifactId,
                host: spec.item.provenance.host,
                path: spec.item.provenance.path,
                service: spec.item.provenance.service,
                ...(spec.item.fragment !== undefined ? { fragmentLabel: fragmentLabel(spec.item) } : {}),
                linkingSource: id === linkFrom,
                linkingTarget: id === targetId,
              }
            : {
                text: spec.item.text,
                isPrivate: spec.item.private,
                linkingSource: id === linkFrom,
                linkingTarget: id === targetId,
              };
        const existing = byId.get(id);
        const position = existing?.position ?? positions[id] ?? defaultPosition(index);
        next.push({
          id,
          position,
          selected: existing?.selected ?? false,
          data,
          type: spec.kind === "evidence" ? "document" : "note",
        } as BoardNode);
        index += 1;
      }
      return next;
    });
  }, [order, specs, linkFrom, targetId, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    return linkList
      .filter((l) => specs.has(l.from) && specs.has(l.to))
      .map((l) => ({
        id: l.id,
        source: l.from,
        target: l.to,
        type: "smoothstep",
        label: `${l.relation} ${confidenceDots(l.confidence)}`,
        ariaLabel: `${shortLabel(specs.get(l.from))} ${RELATION_SENTENCE[l.relation]} ${shortLabel(
          specs.get(l.to)
        )} — confidence ${l.confidence} of 3`,
        labelStyle: { fill: "var(--iz-ink)", fontSize: 11 },
        labelBgStyle: { fill: "var(--iz-bg3)" },
        labelBgPadding: [6, 2] as [number, number],
        labelBgBorderRadius: 3,
        style: {
          stroke: l.id === selectedEdgeId ? "var(--iz-accent-strong)" : "var(--iz-line2)",
          strokeWidth: l.id === selectedEdgeId ? 2 : 1.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6f7d86" },
        selected: l.id === selectedEdgeId,
      }));
  }, [linkList, specs, selectedEdgeId]);

  const onNodesChange = useCallback(
    (changes: NodeChange<BoardNode>[]) => {
      // Server authority: nodes only ever appear/disappear via events, never
      // through canvas deletions.
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== "remove"),
          current
        )
      );
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") {
          // Defensive: the canvas cannot delete links, only the server can.
          void dispatch({ type: "unlink", linkId: change.id });
        } else if (change.type === "select") {
          setSelectedEdgeId(change.selected ? change.id : undefined);
        }
      }
    },
    [dispatch]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: BoardNode) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
      setSelectedEdgeId(undefined);
    },
    [setNodes]
  );

  const onEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      setSelectedEdgeId(edge.id);
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
    },
    [setNodes]
  );

  const onPaneClick = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
    setSelectedEdgeId(undefined);
  }, [setNodes]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: BoardNode) => {
      useBoardPositions.getState().setPosition(node.id, node.position);
    },
    []
  );

  const onConnect = useCallback((connection: Connection) => {
    const { source, target } = connection;
    if (source === undefined || target === undefined || source === target) return;
    setDraft({ from: source, to: target, relation: "supports", confidence: 2 });
  }, []);

  const removeLink = useCallback(
    (linkId: string) => {
      void dispatch({ type: "unlink", linkId }).then(({ rejection }) => {
        if (rejection === undefined) {
          announce("Link removed.");
          setSelectedEdgeId((current) => (current === linkId ? undefined : current));
        }
      });
    },
    [dispatch]
  );

  const openItem = useCallback(
    (id: string, kind: "evidence" | "claim") => {
      setDetails({ id, kind });
      onOpenItem?.({ id, kind });
    },
    [onOpenItem]
  );

  const relayout = useCallback(() => {
    const positions = layeredLayout(order, linkList);
    setNodes((nds) => nds.map((n) => ({ ...n, position: positions[n.id] ?? n.position })));
    useBoardPositions.getState().replaceAll(positions);
    window.setTimeout(() => {
      void fitView({ padding: 0.15, duration: prefersReducedMotion() ? 0 : 160 });
    }, 30);
    announce("Board reorganized.");
  }, [order, linkList, setNodes, fitView]);

  const zoomToFit = useCallback(() => {
    void fitView({ padding: 0.15, duration: prefersReducedMotion() ? 0 : 160 });
  }, [fitView]);

  const moveSelection = useCallback(
    (delta: number) => {
      setNodes((nds) => {
        if (nds.length === 0) return nds;
        const currentIndex = nds.findIndex((n) => n.selected);
        const nextIndex =
          currentIndex === -1
            ? delta > 0
              ? 0
              : nds.length - 1
            : (currentIndex + delta + nds.length) % nds.length;
        return nds.map((n, i) => ({ ...n, selected: i === nextIndex }));
      });
    },
    [setNodes]
  );

  const moveTarget = useCallback(
    (delta: number) => {
      if (targetOrder.length === 0) return;
      setTargetIndex((current) => (current + delta + targetOrder.length) % targetOrder.length);
    },
    [targetOrder.length]
  );

  const startLink = useCallback(
    (fromId: string) => {
      setLinkFrom(fromId);
      setTargetIndex(0);
      announce(
        `Linking from ${detailLabel(specs.get(fromId))}. Choose a target with the arrow keys, then press Enter.`
      );
    },
    [specs]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (draft !== undefined) return; // the modal owns the keyboard
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select") !== null) return;
    const selectedIndex = nodes.findIndex((n) => n.selected);
    const selectedId = selectedIndex >= 0 ? nodes[selectedIndex]?.id : undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        if (linkFrom !== undefined) moveTarget(1);
        else moveSelection(1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        if (linkFrom !== undefined) moveTarget(-1);
        else moveSelection(-1);
        return;
      case "Enter":
        event.preventDefault();
        if (linkFrom !== undefined) {
          if (linkFrom !== undefined && targetId !== undefined) {
            setDraft({ from: linkFrom, to: targetId, relation: "supports", confidence: 2 });
          }
        } else if (selectedId !== undefined) {
          const spec = specs.get(selectedId);
          if (spec !== undefined) openItem(selectedId, spec.kind);
        }
        return;
      case "l":
      case "L": {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (linkFrom !== undefined) return;
        event.preventDefault();
        if (selectedId === undefined) {
          announce("Select a node first, then press L to link it to another.");
        } else {
          startLink(selectedId);
        }
        return;
      }
      case "Escape":
        if (linkFrom !== undefined) {
          setLinkFrom(undefined);
          announce("Link cancelled.");
        }
        return;
      case "Delete":
      case "Backspace":
        if (selectedEdgeId === undefined) return;
        event.preventDefault();
        removeLink(selectedEdgeId);
        return;
      default:
        return;
    }
  };

  const detailSpec = details !== undefined ? specs.get(details.id) : undefined;

  return (
    <div className="iz-bd" data-view="board">
      <div className="iz-toolbar" role="toolbar" aria-label="Board controls">
        <button type="button" className="iz-btn" onClick={relayout}>
          Auto-layout
        </button>
        <button type="button" className="iz-btn" onClick={zoomToFit}>
          Zoom to fit
        </button>
        <span className="iz-bd__hint" aria-hidden="true">
          <span className="iz-kbd">↑↓←→</span> select · <span className="iz-kbd">↵</span> open ·{" "}
          <span className="iz-kbd">L</span> link · <span className="iz-kbd">Del</span> unlink
        </span>
      </div>

      {linkFrom !== undefined && draft === undefined && (
        <p className="iz-bd__linkmode" role="status">
          Linking from <strong>{detailLabel(specs.get(linkFrom))}</strong> — choose a target with the
          arrow keys, press Enter to confirm, Escape to cancel.
        </p>
      )}

      <div className="iz-bd__main">
        <div
          className="iz-bd__canvas"
          tabIndex={0}
          role="application"
          aria-label="Evidence board. Arrow keys move the selection, Enter opens an item, L starts a link, Delete removes the selected link."
          onKeyDown={onKeyDown}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            deleteKeyCode={null}
            minZoom={0.2}
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#2a333c" />
          </ReactFlow>
        </div>

        <aside className="iz-bd__side" aria-label="Board details and links">
          {details !== undefined && detailSpec !== undefined && (
            <section className="iz-bd__details" aria-live="polite">
              <h2 className="iz-bd__side-title">{detailSpec.kind === "claim" ? "Claim" : "Evidence"}</h2>
              {detailSpec.kind === "claim" ? (
                <p className="iz-bd__details-text">{detailSpec.item.text}</p>
              ) : (
                <p className="iz-bd__details-text">{shortLabel(detailSpec)}</p>
              )}
              <p className="iz-bd__details-meta">
                {detailSpec.kind === "claim"
                  ? `noted by ${detailSpec.item.createdBy}`
                  : `artifact ${detailSpec.item.artifactId} · collected by ${detailSpec.item.collectedBy}`}
              </p>
            </section>
          )}

          <section className="iz-bd__links">
            <h2 className="iz-bd__side-title">Links</h2>
            {edges.length === 0 && (
              <p className="iz-bd__links-empty">No links yet. Select a node and press L.</p>
            )}
            <ul className="iz-bd__links-list" aria-label="Links on this board">
              {linkList
                .filter((l) => specs.has(l.from) && specs.has(l.to))
                .map((l) => (
                  <li key={l.id} className="iz-bd__links-row">
                    <span className="iz-bd__links-text">
                      <span className="iz-bd__links-relation">{l.relation}</span>{" "}
                      {shortLabel(specs.get(l.from))} → {shortLabel(specs.get(l.to))}{" "}
                      <span aria-hidden="true">{confidenceDots(l.confidence)}</span>
                    </span>
                    <button
                      type="button"
                      className="iz-btn iz-btn--quiet iz-bd__links-remove"
                      aria-label={`Remove link: ${shortLabel(specs.get(l.from))} ${RELATION_SENTENCE[l.relation]} ${shortLabel(specs.get(l.to))}`}
                      onClick={() => removeLink(l.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </aside>
      </div>

      {draft !== undefined && (
        <div
          className="iz-modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(undefined);
              setLinkFrom(undefined);
            }
          }}
        >
          <div className="iz-modal" role="dialog" aria-modal="true" aria-label="Create a link">
            <div className="iz-modal__head">Create a link</div>
            <div className="iz-modal__body">
              <p className="iz-bd__modal-lede">
                <strong>{shortLabel(specs.get(draft.from))}</strong>
                {" → "}
                <strong>{shortLabel(specs.get(draft.to))}</strong>
              </p>
              <fieldset className="iz-bd__fieldset">
                <legend>Relation</legend>
                {RELATIONS.map((relation, i) => (
                  <label key={relation} className="iz-bd__choice">
                    <input
                      type="radio"
                      name="iz-bd-relation"
                      value={relation}
                      checked={draft.relation === relation}
                      autoFocus={i === 0}
                      onChange={() => setDraft({ ...draft, relation })}
                    />{" "}
                    {relation}
                  </label>
                ))}
              </fieldset>
              <fieldset className="iz-bd__fieldset">
                <legend>Confidence</legend>
                {([1, 2, 3] as const).map((c) => (
                  <label key={c} className="iz-bd__choice">
                    <input
                      type="radio"
                      name="iz-bd-confidence"
                      checked={draft.confidence === c}
                      onChange={() => setDraft({ ...draft, confidence: c })}
                    />{" "}
                    {c} <span aria-hidden="true">{confidenceDots(c)}</span>
                    <span className="iz-visually-hidden"> of 3</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="iz-modal__foot">
              <button
                type="button"
                className="iz-btn"
                onClick={() => {
                  setDraft(undefined);
                  setLinkFrom(undefined);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="iz-btn iz-btn--primary"
                disabled={draft.from === draft.to}
                onClick={() => {
                  const { from, to, relation, confidence } = draft;
                  void dispatch({ type: "link", from, to, relation, confidence }).then(
                    ({ rejection }) => {
                      if (rejection === undefined) announce(`Linked: ${relation}.`);
                      setDraft(undefined);
                      setLinkFrom(undefined);
                    }
                  );
                }}
              >
                Create link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BoardWindow(props: BoardWindowProps): ReactNode {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}
