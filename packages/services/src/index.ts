/**
 * @iz/services — world service modules (master prompt section 10, frozen contract
 * section 19.3). Each service turns parsed world source data into bundle
 * artifacts at build time. This package never touches node builtins: it runs
 * on already-parsed objects and the asset index from the LoadContext.
 *
 * Since M1: each ServiceModule also carries view()/collectibles() (§10). The
 * standalone view builders are re-exported for the server's /api/view route.
 */
export type { AssetRecord, LoadContext, ServiceModule } from "./context.js";
export {
  ServiceError,
  parseSource,
  resolveHost,
  resolveHosts,
  identityIndex,
  entityIndex,
  entityName,
  resolveAssetRef,
  sanitizeIdFragment,
  terminalFileId,
} from "./context.js";

export { compileMarkdown, safeText, emptyRoot, codeRoot, scanStringSafety, MarkdownError } from "./markdown.js";
export type { CompileOptions, MarkdownErrorKind } from "./markdown.js";

export { FORGE_SERVICE } from "./forge.js";
export { MAIL_SERVICE } from "./mail.js";
export { ARCHIVE_SERVICE } from "./archive.js";
export { TERMINAL_SERVICE } from "./terminal.js";
export * from "./forum.js";
export * from "./forum-views.js";
export * from "./views.js";
