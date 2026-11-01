/**
 * @iz/compiler — INTRANET ZERO world compiler.
 *
 * compileWorld(sourceDir, {salt}) turns a world source directory (master prompt
 * section 6.1) into a validated WorldBundle, enforcing build checks 1-12
 * (section 6.5). The `iz` CLI wraps this in dist/cli.js.
 *
 * The markdown -> SafeNode compiler lives in @iz/services (the service modules
 * must emit `ast` and cannot depend on this package); it is re-exported here.
 */
export { compileWorld } from "./pipeline.js";
export type { BuildReport, CompileResult } from "./pipeline.js";
export { BuildError } from "./errors.js";
export type { BuildIssue } from "./errors.js";
export { canonicalJson, computeBundleHash, sha256Hex } from "./hashes.js";
export { isRealTld, loadTlds, parseTldList } from "./tld.js";
export { walkSafeAst, scanDangerous, objectsEqual } from "./checks.js";

// Markdown compilation is implemented in @iz/services and re-exported here.
export { compileMarkdown, safeText, scanStringSafety, MarkdownError } from "@iz/services";
export type { CompileOptions, MarkdownErrorKind } from "@iz/services";
