import { ForumSource } from "@iz/schema";
import type { Artifact } from "@iz/schema";
import { compileMarkdown, safeText } from "./markdown.js";
import { parseSource, resolveHost, type LoadContext, type ServiceModule } from "./context.js";
import { forumView, forumCollectibles } from "./forum-views.js";

/**
 * GHOSTBOARD (§10.7): boards, threads, posts with author identities,
 * timestamps, edits and deletions. Deleted posts show a tombstone; the text is
 * an artifact only if the world marks it visible (authored via conditions).
 */

export const FORUM_SERVICE: ServiceModule = {
  view: forumView,
  collectibles: forumCollectibles,
  id: "forum",
  routes: ["/", "/:board", "/:board/:thread"],
  load(rawSource, ctx: LoadContext): Artifact[] {
    const source = parseSource(ForumSource, rawSource, "forum");
    const host = resolveHost(ctx, "forum");
    const knownIdentities = new Set(ctx.world.identities.map((i) => i.id));
    const artifacts: Artifact[] = [];

    for (const board of source.boards) {
      for (const thread of board.threads) {
        for (const post of thread.posts) {
          if (!knownIdentities.has(post.author)) {
            throw new Error(`forum post ${post.id}: author "${post.author}" is not a known identity`);
          }
          const body = post.deleted ? "[post deleted]" : post.body;
          const lastEdit = post.edits[post.edits.length - 1];
          const ast = compileMarkdown(body, {
            allowedHosts: new Set(ctx.world.world.hosts.map((h) => h.host)),
            resolveAsset: (ref) => ctx.assets.get(ref)?.sha256 ?? null,
          });
          const meta: Record<string, string | number> = {
            board: board.id,
            boardName: board.name,
            thread: thread.id,
            threadTitle: thread.title,
            pinned: thread.pinned ? 1 : 0,
            author: post.author,
            at: post.at,
            edits: post.edits.length,
            deleted: post.deleted ? 1 : 0,
          };
          artifacts.push({
            id: post.id,
            host,
            path: `${board.id}/${thread.id}/${post.id}`,
            kind: "forum-post",
            title: `${thread.title} — ${post.author}`,
            body: safeText(ast),
            ast,
            meta,
            collectible: !post.deleted,
          });
          if (lastEdit !== undefined && !post.deleted) {
            artifacts.push({
              id: `${post.id}-history`,
              host,
              path: `${board.id}/${thread.id}/${post.id}/history`,
              kind: "forum-post",
              title: `${thread.title} — edit history`,
              body: post.edits.map((edit) => `${edit.at}: ${edit.body}`).join("\n---\n"),
              ast: compileMarkdown(
                post.edits.map((edit) => `**${edit.at}**\n\n${edit.body}`).join("\n\n---\n\n"),
                { allowedHosts: new Set(ctx.world.world.hosts.map((h) => h.host)) }
              ),
              meta: { board: board.id, thread: thread.id, historyOf: post.id, editedAt: lastEdit.at },
              collectible: false,
            });
          }
        }
      }
    }
    return artifacts;
  },
};
