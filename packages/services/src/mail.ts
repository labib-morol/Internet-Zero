import { z } from "zod";
import { Mailbox } from "@iz/schema";
import type { Artifact } from "@iz/schema";
import { compileMarkdown, safeText } from "./markdown.js";
import { parseSource, resolveAssetRef, resolveHost, type LoadContext, type ServiceModule } from "./context.js";

const MailSource = z.strictObject({ mailboxes: z.array(Mailbox) });
export type MailSource = z.infer<typeof MailSource>;

function loginAddress(ctx: LoadContext, identityId: string): string {
  const identity = ctx.world.identities.find((i) => i.id === identityId);
  return identity ? identity.login : identityId;
}

/**
 * DEADLETTER loader (section 10.3): every mail message becomes a collectible
 * mail-message artifact on the mail host. Attachment asset references are
 * canonicalized to content-addressed ids; attachment redaction blocks are kept
 * (JSON-encoded) in artifact meta for the "inspect layers" tool.
 */
import { mailView, mailCollectibles } from "./views.js";

export const MAIL_SERVICE: ServiceModule = {
  view: mailView,
  collectibles: mailCollectibles,
  id: "mail",
  routes: ["/", "/:mailbox", "/:mailbox/:folder/:messageId"],
  load(rawSource, ctx: LoadContext): Artifact[] {
    const source = parseSource(MailSource, rawSource, "mail");
    const host = resolveHost(ctx, "mail");
    const astOptions = {
      allowedHosts: new Set(ctx.world.world.hosts.map((h) => h.host)),
      resolveAsset: (ref: string) => ctx.assets.get(ref)?.sha256 ?? null,
    };
    const artifacts: Artifact[] = [];

    for (const mailbox of source.mailboxes) {
      for (const message of mailbox.messages) {
        const ast = compileMarkdown(message.body, astOptions);
        const attachments = message.attachments.map((attachment) => {
          const assetId = resolveAssetRef(ctx, attachment.asset);
          if (assetId === null) {
            throw new Error(`mail message ${message.id}: attachment asset "${attachment.asset}" does not resolve to a world asset`);
          }
          return { asset: assetId, filename: attachment.filename, redactions: attachment.redactions };
        });
        const headerLines = Object.entries(message.headers ?? {}).map(([k, v]) => `${k}: ${v}`);
        const body = [
          `Subject: ${message.subject}`,
          `From: ${loginAddress(ctx, message.from)}`,
          `To: ${message.to.map((t) => loginAddress(ctx, t)).join(", ")}`,
          message.cc.length > 0 ? `Cc: ${message.cc.map((c) => loginAddress(ctx, c)).join(", ")}` : "",
          `Date: ${message.date}`,
          ...headerLines,
          "",
          safeText(ast),
        ]
          .filter((s) => s.length > 0)
          .join("\n");

        const meta: Record<string, string | number> = {
          mailbox: mailbox.id,
          folder: message.folder,
          from: message.from,
          to: message.to.join(", "),
          date: message.date,
          attachments: JSON.stringify(attachments),
        };
        if (message.thread !== undefined) meta.thread = message.thread;
        if (message.headers !== undefined) meta.headers = JSON.stringify(message.headers);

        artifacts.push({
          id: message.id,
          host,
          path: `${mailbox.id}/${message.folder}/${message.id}`,
          kind: "mail-message",
          title: message.subject.length > 0 ? message.subject : "(no subject)",
          body,
          ast,
          meta,
          collectible: true,
        });
      }
    }

    return artifacts;
  },
};
