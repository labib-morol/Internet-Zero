import { z } from "zod";
import { ForgeRepo } from "@iz/schema";
import type { Artifact, SafeNode } from "@iz/schema";
import { compileMarkdown, emptyRoot, safeText } from "./markdown.js";
import { entityName, parseSource, resolveHost, type LoadContext, type ServiceModule } from "./context.js";

const ForgeSource = z.strictObject({ repos: z.array(ForgeRepo) });
export type ForgeSource = z.infer<typeof ForgeSource>;

/** Stable commit artifact id: a.<40-hex sha>. */
export function commitArtifactId(sha: string): string {
  return `a.${sha}`;
}

/** Stable issue artifact id derived from the repo id and issue number. */
export function issueArtifactId(repoId: string, number: number): string {
  return `${repoId}.issue.${number}`;
}

/** Stable user-profile artifact id derived from the login. */
export function userArtifactId(login: string): string {
  const id = `a.user.${login.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
  if (!/^a\.[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`forge login "${login}" cannot be turned into a stable artifact id`);
  }
  return id;
}

function firstLine(message: string): string {
  const line = message.split("\n", 1)[0]?.trim() ?? "";
  return line.length > 0 ? line.slice(0, 120) : "(no message)";
}

function renderChange(kind: string, path: string, before: string | undefined, after: string | undefined): string {
  const lines: string[] = [`${kind}: ${path}`];
  for (const line of (before ?? "").split("\n")) lines.push(`- ${line}`);
  for (const line of (after ?? "").split("\n")) lines.push(`+ ${line}`);
  return lines.join("\n");
}

/**
 * GIT//FORGE loader (section 10.2): one repo artifact, one artifact per commit,
 * issue and user profile, all on the forge host.
 */
import { forgeView, forgeCollectibles } from "./views.js";

export const FORGE_SERVICE: ServiceModule = {
  view: forgeView,
  collectibles: forgeCollectibles,
  id: "forge",
  routes: [
    "/",
    "/:owner/:repo",
    "/:owner/:repo/commits",
    "/:owner/:repo/commit/:sha",
    "/:owner/:repo/issues",
    "/:owner/:repo/issues/:number",
    "/users/:login",
  ],
  load(rawSource, ctx: LoadContext): Artifact[] {
    const source = parseSource(ForgeSource, rawSource, "forge");
    const host = resolveHost(ctx, "forge");
    const artifacts: Artifact[] = [];

    for (const repo of source.repos) {
      const repoPath = `${repo.owner}/${repo.name}`;
      const readmeAst = compileMarkdown(repo.readme, forgeAstOptions(ctx));

      artifacts.push({
        id: repo.id,
        host,
        path: repoPath,
        kind: "repo",
        title: repoPath,
        body: [`${repo.owner}/${repo.name}`, repo.description, safeText(readmeAst)].filter((s) => s.length > 0).join("\n"),
        ast: readmeAst,
        meta: { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch, description: repo.description },
        collectible: false,
      });

      for (const user of repo.users) {
        const bioAst = user.bio === undefined ? emptyRoot() : compileMarkdown(user.bio, forgeAstOptions(ctx));
        artifacts.push({
          id: userArtifactId(user.login),
          host,
          path: `users/${user.login}`,
          kind: "user",
          title: user.name ?? user.login,
          body: [user.login, user.name ?? "", user.bio ?? "", user.deleted ? "account deleted" : ""]
            .filter((s) => s.length > 0)
            .join("\n"),
          ast: bioAst,
          meta: { login: user.login, deleted: user.deleted ? "true" : "false" },
          collectible: false,
        });
      }

      for (const commit of repo.commits) {
        const messageAst = compileMarkdown(commit.message, forgeAstOptions(ctx));
        const children: SafeNode[] = [...messageAst.children];
        for (const change of commit.changes) {
          children.push({
            type: "code",
            lang: "diff",
            value: renderChange(change.kind, change.path, "before" in change ? change.before : undefined, "after" in change ? change.after : undefined),
          });
        }
        artifacts.push({
          id: commitArtifactId(commit.sha),
          host,
          path: `${repoPath}/commit/${commit.sha}`,
          kind: "commit",
          title: firstLine(commit.message),
          body: [commit.message, ...commit.changes.map((c) => renderChange(c.kind, c.path, "before" in c ? c.before : undefined, "after" in c ? c.after : undefined))].join("\n"),
          ast: { type: "root", children },
          meta: {
            repo: repo.id,
            sha: commit.sha,
            authorName: commit.author.name,
            authorEmail: commit.author.email,
            committerEmail: commit.committer.email,
            date: commit.date,
            signed: commit.signature === undefined ? "false" : "true",
          },
          collectible: true,
        });
      }

      for (const issue of repo.issues) {
        const bodyAst = compileMarkdown(issue.body, forgeAstOptions(ctx));
        const children: SafeNode[] = [...bodyAst.children];
        for (const comment of issue.comments) {
          children.push({
            type: "blockquote",
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "strong", children: [{ type: "text", value: `@${entityName(ctx, comment.author)}` }] },
                  { type: "text", value: ` ${comment.date}` },
                ],
              },
              ...compileMarkdown(comment.body, forgeAstOptions(ctx)).children,
            ],
          });
        }
        const commentText = issue.comments.map((c) => `${entityName(ctx, c.author)}: ${c.body}`).join("\n");
        artifacts.push({
          id: issueArtifactId(repo.id, issue.number),
          host,
          path: `${repoPath}/issues/${issue.number}`,
          kind: "issue",
          title: issue.title,
          body: [issue.title, issue.body, commentText].filter((s) => s.length > 0).join("\n"),
          ast: { type: "root", children },
          meta: { repo: repo.id, number: issue.number, author: issue.author, date: issue.date, state: issue.state },
          collectible: false,
        });
      }
    }

    return artifacts;
  },
};

function forgeAstOptions(ctx: LoadContext) {
  return {
    allowedHosts: new Set(ctx.world.world.hosts.map((h) => h.host)),
    resolveAsset: (ref: string) => (ctx.assets.get(ref)?.sha256 ?? null),
  };
}
