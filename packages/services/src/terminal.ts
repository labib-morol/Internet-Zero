import { z } from "zod";
import { TerminalFs } from "@iz/schema";
import type { Artifact } from "@iz/schema";
import { codeRoot } from "./markdown.js";
import { parseSource, resolveHosts, terminalFileId, type LoadContext, type ServiceModule } from "./context.js";

const TerminalFile = z.strictObject({ host: z.string().min(1), path: z.string().min(1), text: z.string() });
const TerminalSource = z.strictObject({ fs: TerminalFs, files: z.array(TerminalFile) });
export type TerminalSource = z.infer<typeof TerminalSource>;

/**
 * NODE TERMINAL loader (section 10.5): every virtual file becomes a
 * terminal-file artifact (id `a.<host>.<sanitized path>`, body = file text,
 * AST = one code block). Host metadata (motd, connectGate) is carried on every
 * file's meta because the frozen WorldBundle has no separate fs-metadata slot.
 * Terminal may run on multiple hosts; the compiler assigns files by fs tree
 * directory, so no single-host restriction applies here.
 */
export const TERMINAL_SERVICE: ServiceModule = {
  id: "terminal",
  routes: ["/", "/:host"],
  load(rawSource, ctx: LoadContext): Artifact[] {
    const source = parseSource(TerminalSource, rawSource, "terminal");
    const declaredHosts = new Set(resolveHosts(ctx, "terminal"));
    const hostMeta = new Map(source.fs.hosts.map((h) => [h.host, h]));
    const artifacts: Artifact[] = [];

    for (const host of source.fs.hosts) {
      if (!declaredHosts.has(host.host)) {
        throw new Error(`terminal fs.yaml host "${host.host}" is not declared in world.yaml with service "terminal"`);
      }
    }

    for (const file of source.files) {
      if (!declaredHosts.has(file.host)) {
        throw new Error(`terminal file "${file.path}" belongs to host "${file.host}" which is not declared in world.yaml with service "terminal"`);
      }
      const meta = hostMeta.get(file.host);
      if (meta === undefined) {
        throw new Error(`terminal file "${file.path}" belongs to host "${file.host}" which is missing from fs.yaml`);
      }
      const artifactMeta: Record<string, string | number> = { host: file.host };
      if (meta.motd !== undefined) artifactMeta.motd = meta.motd;
      if (meta.connectGate !== undefined) artifactMeta.connectGate = meta.connectGate;

      artifacts.push({
        id: terminalFileId(file.host, file.path),
        host: file.host,
        path: file.path,
        kind: "terminal-file",
        title: file.path,
        body: file.text,
        ast: codeRoot(file.text),
        meta: artifactMeta,
        collectible: false,
      });
    }

    return artifacts;
  },
};
