import type { WorldBundle, RuntimeState, NotFound, Collectible, ForumBoard, ViewModel } from "@iz/schema";
import { artifactVisible } from "@iz/runtime";
import type { IsUnlocked } from "@iz/runtime";

function postVisible(bundle: WorldBundle, state: RuntimeState, artifactId: string, now: string): boolean {
  const artifact = bundle.artifacts.find((a) => a.id === artifactId);
  if (artifact === undefined) return false;
  const isUnlocked: IsUnlocked = (id) => state.unlocked.has(id);
  return artifactVisible(bundle, artifact, state, isUnlocked, now);
}

/**
 * GHOSTBOARD views (§10.7): board list, board threads, thread posts. Only
 * visible post artifacts are rendered; deleted posts render as tombstones.
 */
export function forumView(
  bundle: WorldBundle,
  state: RuntimeState,
  host: string,
  rawPath: string,
  now: string
): ViewModel | NotFound {
  const notFound: NotFound = { notFound: true, host, path: rawPath };
  const boards: ForumBoard[] = bundle.forum.filter((board) =>
    bundle.artifacts.some((a) => a.host === host && a.kind === "forum-post" && a.meta.board === board.id)
  );
  if (boards.length === 0) return notFound;
  const segments = rawPath.replace(/^\//, "").split("/").filter((s) => s !== "");

  if (segments.length === 0) {
    return {
      view: "forum-board-list",
      host,
      boards: boards.map((board) => ({
        boardId: board.id,
        name: board.name,
        threads: board.threads.length,
        posts: board.threads.reduce((sum, thread) => sum + thread.posts.length, 0),
      })),
    };
  }

  const board = boards.find((b) => b.id === segments[0]);
  if (board === undefined) return notFound;

  if (segments.length === 1) {
    const threads = board.threads.map((thread) => {
      const visible = thread.posts.filter((post) => postVisible(bundle, state, post.id, now));
      const last = visible[visible.length - 1];
      return {
        threadId: thread.id,
        title: thread.title,
        pinned: thread.pinned,
        posts: visible.length,
        lastAt: last?.at ?? "",
        lastAuthor: last?.author ?? "",
      };
    });
    return { view: "forum-board", host, artifactId: null, boardId: board.id, boardName: board.name, threads };
  }

  const thread = board.threads.find((t) => t.id === segments[1]);
  if (thread === undefined) return notFound;
  const posts = thread.posts
    .filter((post) => postVisible(bundle, state, post.id, now))
    .map((post) => {
      const identity = bundle.identities.find((i) => i.id === post.author);
      return {
        artifactId: post.id,
        author: { identityId: post.author, displayName: identity?.displayName ?? post.author, deleted: identity?.deleted ?? false },
        at: post.at,
        ast: bundle.artifacts.find((a) => a.id === post.id)!.ast,
        deleted: post.deleted,
        edits: post.edits.length,
      };
    });
  if (posts.length === 0) return notFound;
  return {
    view: "forum-thread",
    host,
    artifactId: posts[0]!.artifactId,
    boardId: board.id,
    threadId: thread.id,
    title: thread.title,
    pinned: thread.pinned,
    posts,
  };
}

export function forumCollectibles(view: ViewModel): Collectible[] {
  if ("view" in view && view.view === "forum-thread") {
    return view.posts
      .filter((post) => !post.deleted)
      .map((post) => ({ artifactId: post.artifactId, label: `Forum post by ${post.author.displayName}` }));
  }
  return [];
}
