/**
 * Ambient declaration for Vite's import.meta.glob as used by the determinism
 * self-test. The runtime package's tsconfig does not reference vite/client, so
 * we declare exactly the overload we use.
 */
declare interface ImportMeta {
  glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}
