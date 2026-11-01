import type { ReactNode } from "react";
import type { IdentityRef } from "@iz/schema";
import { useBrowserStore } from "../../browser/store.js";

/**
 * Shared chrome for the per-service UIs (M1 tasks 4–6): a service masthead
 * with the in-fiction brand and breadcrumb trail, the §11.1 Collect affordance
 * for collectible views, and identity chips that never hide a deleted account.
 * All in-page links route through the in-game browser store — nothing here
 * ever touches window.location (§10.1).
 */

export interface GameLinkProps {
  host: string;
  path: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/** Link that navigates the in-game browser. Renders a real <a> for keyboard paths. */
export function GameLink({ host, path, children, className, ariaLabel }: GameLinkProps): ReactNode {
  return (
    <a
      href="#"
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.preventDefault();
        void useBrowserStore.getState().navigate(host, path);
      }}
    >
      {children}
    </a>
  );
}

/** Route an AST link target (in-game hosts only, §10.6) through the browser. */
export function openInGameLink(url: string): void {
  const store = useBrowserStore.getState();
  // SafeAst links are in-game URLs like "host/path"; the address parser
  // normalizes them (and tolerates a scheme, though none should exist).
  void store.goToAddress(url);
}

export interface CollectButtonProps {
  artifactId: string;
  label: string;
  onCollect: (artifactId: string, label?: string) => void;
}

/** The §11.1 Collect button shown on every collectible view. */
export function CollectButton({ artifactId, label, onCollect }: CollectButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="iz-collectbtn"
      aria-label={`Collect evidence: ${label}`}
      onClick={() => onCollect(artifactId, label)}
    >
      Collect
    </button>
  );
}

export interface ServiceFrameProps {
  brand: string;
  host: string;
  /** Breadcrumb segments; each {label, path}. Rendered last-to-first? No: in order, root first. */
  crumbs?: Array<{ label: string; path?: string }>;
  /** Collect affordance for this page's artifact, when the view is collectible. */
  collect?: CollectButtonProps;
  /** The service content. */
  children: ReactNode;
}

export function ServiceFrame({ brand, host, crumbs = [], collect, children }: ServiceFrameProps): ReactNode {
  return (
    <div className="iz-svc">
      <div className="iz-svc__masthead">
        <span className="iz-svc__brand">{brand}</span>
        <nav className="iz-svc__crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} style={{ display: "inline-flex", gap: 6 }}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {crumb.path !== undefined ? (
                <GameLink host={host} path={crumb.path}>{crumb.label}</GameLink>
              ) : (
                <span style={{ color: "var(--iz-ink)" }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        {collect !== undefined && <CollectButton {...collect} />}
      </div>
      <div className="iz-svc__body iz-doc" style={{ width: "100%", maxWidth: "none" }}>
        {children}
      </div>
    </div>
  );
}

/** Identity chip; deleted accounts are struck through and labelled. */
export function IdentityChip({ identity }: { identity: IdentityRef }): ReactNode {
  if (identity.deleted) {
    return (
      <span className="iz-identity iz-identity--deleted" title="This account was deleted">
        <span className="iz-identity__name">{identity.displayName}</span>
        <span className="iz-identity__deletedtag">account deleted</span>
      </span>
    );
  }
  return (
    <span className="iz-identity">
      <span className="iz-identity__name">{identity.displayName}</span>
      {identity.login !== undefined && <span style={{ color: "var(--iz-faint)" }}>@{identity.login}</span>}
    </span>
  );
}

/** Short muted date ("2026-10-04") from an ISO timestamp. */
export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function EmptyNote({ children }: { children: ReactNode }): ReactNode {
  return <p style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>{children}</p>;
}
