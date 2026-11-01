import { z } from "zod";
import { ArchiveDocMeta } from "@iz/schema";
import type { Artifact } from "@iz/schema";
import { compileMarkdown, safeText } from "./markdown.js";
import { parseSource, resolveAssetRef, resolveHost, type LoadContext, type ServiceModule } from "./context.js";

const ArchiveDoc = z.strictObject({ meta: ArchiveDocMeta, body: z.string() });
const ArchiveSource = z.strictObject({ docs: z.array(ArchiveDoc) });
export type ArchiveSource = z.infer<typeof ArchiveSource>;

/**
 * THE ARCHIVE loader (section 10.4): every front-matter document becomes a
 * collectible archive-document artifact. Asset references in `meta.assets` are
 * canonicalized to content-addressed ids; EXIF-like meta fields and redaction
 * blocks travel in artifact meta.
 */
import { archiveView, archiveCollectibles } from "./views.js";

export const ARCHIVE_SERVICE: ServiceModule = {
  view: archiveView,
  collectibles: archiveCollectibles,
  id: "archive",
  routes: ["/", "/search", "/documents/:id"],
  load(rawSource, ctx: LoadContext): Artifact[] {
    const source = parseSource(ArchiveSource, rawSource, "archive");
    const host = resolveHost(ctx, "archive");
    const astOptions = {
      allowedHosts: new Set(ctx.world.world.hosts.map((h) => h.host)),
      resolveAsset: (ref: string) => ctx.assets.get(ref)?.sha256 ?? null,
    };
    const artifacts: Artifact[] = [];

    for (const doc of source.docs) {
      const ast = compileMarkdown(doc.body, astOptions);
      const assetIds: string[] = [];
      for (const ref of doc.meta.assets) {
        const assetId = resolveAssetRef(ctx, ref);
        if (assetId === null) {
          throw new Error(`archive document ${doc.meta.id}: asset "${ref}" does not resolve to a world asset`);
        }
        assetIds.push(assetId);
      }

      const meta: Record<string, string | number> = {
        type: doc.meta.type,
        date: doc.meta.date,
        source: doc.meta.source,
        assets: assetIds.join(","),
        redactions: JSON.stringify(doc.meta.redactions),
      };
      for (const [key, value] of Object.entries(doc.meta.meta ?? {})) meta[key] = value;

      artifacts.push({
        id: doc.meta.id,
        host,
        path: `documents/${doc.meta.id}`,
        kind: "archive-document",
        title: doc.meta.title,
        body: [doc.meta.title, doc.meta.source, safeText(ast)].filter((s) => s.length > 0).join("\n"),
        ast,
        meta,
        collectible: true,
      });
    }

    return artifacts;
  },
};
