import { useEffect, useState } from "react";
import type { ViewModel } from "@iz/schema";
import { createIzClient, useSessionStore, type IzClient } from "@iz/ui";

/**
 * Per-session artifact title cache for the notebook's document cards.
 *
 * The wire state stores only `artifactId` + `provenance {host, path, service}`
 * (§7) — no human-readable title. Titles are resolved with GET /api/view for
 * the item's provenance page: the server returns a view model ONLY for pages
 * the team can already see (locked and unknown hosts are indistinguishable
 * notFounds, §10.1), so this cache never widens visibility — it just names
 * what the team has already seen. Pages that yield no title for the artifact
 * fall back to `host+path` in the UI.
 *
 * The cache stores VIEW MODELS keyed by (team, page); the title is derived
 * per artifact from the same fetched view, so sibling evidence collected on
 * one page resolves without extra requests. `undefined` entries mark pages
 * that are not visible (yet) — retried on the next cache miss, never in a
 * loop while mounted.
 */

type CachedView = ViewModel | "unreachable";

const cache = new Map<string, CachedView>();
const inflight = new Map<string, Promise<CachedView>>();

function cacheKey(teamId: string, host: string, path: string): string {
  return `${teamId}|${host}|${path}`;
}

/** Test seam: drop every cached and in-flight view. */
export function resetTitleCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

function viewClient(): IzClient {
  // A fresh client per cache-miss batch: it captures the CURRENT fetch
  // implementation (tests stub globalThis.fetch), and client construction is
  // cheap — one object per session page, never per keystroke.
  return createIzClient({ getToken: () => useSessionStore.getState().session?.token });
}

function firstLine(text: string): string {
  return (text.split("\n", 1)[0] ?? "").trim();
}

/**
 * The title of `artifactId` inside a fetched view model, if the view names
 * that artifact. Explicit per-kind mapping over the frozen view contract
 * (§19.3) — no guessing from arbitrary fields.
 */
export function titleFromView(view: ViewModel, artifactId: string): string | undefined {
  if ("notFound" in view) return undefined;
  switch (view.view) {
    case "repo-home":
      return view.artifactId === artifactId ? `${view.owner}/${view.name}` : undefined;
    case "commit-list":
      return view.artifactId === artifactId ? `${view.owner}/${view.name} · commit log` : undefined;
    case "commit-detail": {
      if (view.artifactId !== artifactId) return undefined;
      const sha = view.commit.sha.slice(0, 7);
      const message = firstLine(view.commit.message);
      return message !== "" ? `${sha} — ${message}` : `commit ${sha}`;
    }
    case "file-browser":
      return view.artifactId === artifactId
        ? `${view.owner}/${view.name}${view.path}`
        : undefined;
    case "issue-list":
      return view.artifactId === artifactId ? `${view.owner}/${view.name} · issues` : undefined;
    case "issue-detail":
      return view.artifactId === artifactId
        ? `Issue #${view.issue.number}: ${view.issue.title}`
        : undefined;
    case "user-profile":
      return view.artifactId === artifactId ? (view.name ?? view.login) : undefined;
    case "mailbox":
      return undefined; // a mailbox page holds many messages; no per-artifact title
    case "thread":
      return view.messages.some((m) => m.artifactId === artifactId) ? view.subject : undefined;
    case "message":
      return view.message.artifactId === artifactId ? view.message.subject : undefined;
    case "archive-search": {
      const hit = view.results.find((r) => r.artifactId === artifactId);
      return hit?.title;
    }
    case "archive-document":
      return view.doc.id === artifactId ? view.doc.title : undefined;
    case "terminal":
      return undefined;
  }
}

async function resolveView(teamId: string, host: string, path: string): Promise<CachedView> {
  const key = cacheKey(teamId, host, path);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let pending: Promise<CachedView> | undefined = inflight.get(key);
  if (pending === undefined) {
    const fetch: Promise<CachedView> = viewClient()
      .getView(host, path)
      .then((response): CachedView => {
        const view: CachedView = response.view;
        cache.set(key, view);
        return view;
      })
      .catch((): CachedView => {
        // 404/notFound/401/network: not cached — a later cache miss (e.g.
        // after the team unlocks the page) may still resolve a title.
        return "unreachable";
      })
      .finally(() => {
        inflight.delete(key);
      });
    pending = fetch;
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * Resolved artifact title, or undefined while unknown / not resolvable.
 * Fetches at most once per (team, page) per session; callers render
 * `host+path` until (and unless) a title arrives.
 */
export function useArtifactTitle(host: string, path: string, artifactId: string): string | undefined {
  const teamId = useSessionStore((s) => s.state?.teamId ?? "");
  const [title, setTitle] = useState<string | undefined>(() => {
    if (host === "") return undefined;
    const view = cache.get(cacheKey(teamId, host, path));
    return view !== undefined && view !== "unreachable" ? titleFromView(view, artifactId) : undefined;
  });

  useEffect(() => {
    if (host === "") return; // provenance not yet known (teammate event pending refresh)
    let alive = true;
    void resolveView(teamId, host, path).then((view) => {
      if (!alive) return;
      const resolved = view === "unreachable" ? undefined : titleFromView(view, artifactId);
      setTitle((prev) => prev ?? resolved);
    });
    return () => {
      alive = false;
    };
  }, [teamId, host, path, artifactId]);

  return title;
}
