import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoSnapshot } from '../core/types.ts';

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const MAX_DEPTH = 4;
const MAX_FILES = 20_000;
const MAX_TEXT_BYTES = 256 * 1024;
/** Root-level files whose text the checks need. */
const TEXT_FILE = /^(?:readme|licen[sc]e|copying)(?:[.-][a-z0-9.-]+)?$/i;

/**
 * Builds a snapshot from a local folder. Read-only.
 * Symbolic links are not followed, so the scan cannot leave the folder.
 */
export function readLocalRepo(root: string): RepoSnapshot {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const files: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const relative = prefix + entry.name;
      if (entry.isFile()) {
        files.push(relative);
      } else if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && depth < MAX_DEPTH) {
        walk(join(dir, entry.name), `${relative}/`, depth + 1);
      }
    }
  };
  walk(root, '', 0);
  files.sort();

  const contents: Record<string, string> = {};
  for (const file of files) {
    if (!TEXT_FILE.test(file)) continue;
    const full = join(root, file);
    if (statSync(full).size <= MAX_TEXT_BYTES) {
      contents[file] = readFileSync(full, 'utf8');
    }
  }

  return { origin: root, files, contents };
}
