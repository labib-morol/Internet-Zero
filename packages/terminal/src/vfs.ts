/**
 * Virtual filesystem helpers. The fs is a flat map of absolute POSIX-style
 * paths to text content; directories are implied by path prefixes.
 */

export type VirtualFs = Readonly<Record<string, string>>;
export type Overlay = Readonly<Record<string, string>>;

export function normalizePath(cwd: string, arg?: string): string {
  const base = arg === undefined || arg === "" ? cwd : arg.startsWith("/") ? arg : joinPaths(cwd, arg);
  const parts: string[] = [];
  for (const seg of base.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return "/" + parts.join("/");
}

function joinPaths(cwd: string, rel: string): string {
  return `${cwd.replace(/\/+$/, "")}/${rel}`;
}

export function isDir(fs: VirtualFs, overlay: Overlay, path: string): boolean {
  const p = path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`;
  if (p === "/") return true;
  for (const key of Object.keys(fs)) if (key.startsWith(p)) return true;
  for (const key of Object.keys(overlay)) if (key.startsWith(p)) return true;
  return false;
}

export function readFile(fs: VirtualFs, overlay: Overlay, path: string): string | undefined {
  const rel = path.replace(/^\/+/, "");
  return overlay[path] ?? overlay[rel] ?? fs[path];
}

/** Overlay keys are relative (no leading slash); listDir expects absolute. */
export function overlayAsAbsolute(overlay: Overlay): Overlay {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(overlay)) out[`/${k.replace(/^\/+/, "")}`] = v;
  return out;
}

/** Entries of a directory: child files and implied child directories. */
export function listDir(
  fs: VirtualFs,
  overlay: Overlay,
  dir: string
): Array<{ name: string; kind: "file" | "dir" }> {
  const prefix = dir === "/" ? "/" : `${dir.replace(/\/+$/, "")}/`;
  const names = new Map<string, "file" | "dir">();
  const consider = (key: string, isOverlayFile: boolean) => {
    if (!key.startsWith(prefix)) return;
    const rest = key.slice(prefix.length);
    if (rest === "") return;
    const slash = rest.indexOf("/");
    if (slash === -1) names.set(rest, isOverlayFile ? "file" : "file");
    else names.set(rest.slice(0, slash), "dir");
  };
  for (const key of Object.keys(fs)) consider(key, false);
  for (const key of Object.keys(overlay)) consider(key, true);
  return [...names.entries()]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Content lines without a phantom trailing empty element. */
export function splitLines(content: string): string[] {
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}

/** Read a file's content, honoring overlay precedence; undefined when absent.
 * Overlay keys may be relative (no leading slash) or absolute. */
export function readForCommand(
  fs: VirtualFs,
  overlay: Overlay,
  path: string
): { found: true; content: string; fromOverlay: boolean } | { found: false } {
  const rel = path.replace(/^\/+/, "");
  const hit = path in overlay ? path : rel in overlay ? rel : undefined;
  if (hit !== undefined) return { found: true, content: overlay[hit]!, fromOverlay: true };
  if (path in fs) return { found: true, content: fs[path]!, fromOverlay: false };
  return { found: false };
}
