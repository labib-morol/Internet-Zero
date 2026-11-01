import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/valid-world", import.meta.url));
export const TEST_SALT = "0123456789abcdef0123456789abcdef";

/** A text mutation applied to one file of the fixture world. */
export type Mutation = {
  file: string;
  /** Replaces the first occurrence unless `all` is set. */
  replace?: [from: string, to: string, all?: boolean];
  /** Appends raw text to the file. */
  append?: string;
};

/** Copies the fixture world to a fresh temp dir and applies text mutations. */
export async function mutatedWorld(mutations: Mutation[], options: { dropAssets?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "iz-world-"));
  await cp(FIXTURE_DIR, dir, { recursive: true });
  for (const mutation of mutations) {
    const path = join(dir, mutation.file);
    let content = await readFile(path, "utf8");
    if (mutation.replace !== undefined) {
      const [from, to, all] = mutation.replace;
      if (!content.includes(from)) throw new Error(`mutation target not found in ${mutation.file}: ${JSON.stringify(from)}`);
      content = all === true ? content.split(from).join(to) : content.replace(from, to);
    }
    if (mutation.append !== undefined) content += mutation.append;
    await writeFile(path, content, "utf8");
  }
  if (options.dropAssets === true) {
    await rm(join(dir, "assets"), { recursive: true, force: true });
    // Drop the image reference from the archive doc...
    const docPath = join(dir, "services", "archive", "printer-log.md");
    await writeFile(docPath, (await readFile(docPath, "utf8")).replace(/^!\[maintenance sticker\]\(assets\/sticker\.png\)\n/m, ""), "utf8");
    // ...and the whole attachments block from the mail message.
    const mailPath = join(dir, "services", "mail", "mailboxes.yaml");
    const lines = (await readFile(mailPath, "utf8")).split("\n");
    const cleaned: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === "      attachments:") {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith("        ")) i += 1;
        continue;
      }
      cleaned.push(line);
    }
    await writeFile(mailPath, cleaned.join("\n"), "utf8");
  }
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
