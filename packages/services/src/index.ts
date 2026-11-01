/**
 * @iz/services — world service modules (master prompt section 10, frozen contract
 * section 19.3). Each service turns parsed world source data into bundle
 * artifacts at build time. This package never touches node builtins: it runs
 * on already-parsed objects and the asset index from the LoadContext.
 *
 * M1 note: `view()` and `collectibles()` from the full ServiceModule contract
 * arrive in M1 and are intentionally omitted (not stubbed).
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
