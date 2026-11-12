import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clean } from '../core/text.ts';
import type { RepoSnapshot } from '../core/types.ts';
import { MAX_FILES, MAX_TEXT_BYTES, reason, TEXT_FILE } from './shared.ts';

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const MAX_DEPTH = 4;

export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface StatLike {
  isDirectory(): boolean;
  size: number;
}

/** The few file-system operations the scan needs, so tests can inject failures. */
export interface LocalFs {
  stat(path: string): StatLike | undefined;
  readdir(path: string): DirEntry[];
  readText(path: string): string;
}

const nodeFs: LocalFs = {
  stat: (path) => statSync(path, { throwIfNoEntry: false }),
  readdir: (path) => readdirSync(path, { withFileTypes: true }),
  readText: (path) => readFileSync(path, 'utf8'),
};

/**
 * Builds a snapshot from a local folder. Read-only.
 * Symbolic links and junctions are never followed, so the scan cannot leave the folder.
 * Problems below the top folder are recorded as notes instead of aborting the scan.
 */
export function readLocalRepo(root: string, fs: LocalFs = nodeFs): RepoSnapshot {
  let rootStat: StatLike | undefined;
  try {
    rootStat = fs.stat(root);
  } catch (error) {
    throw new Error(`Cannot access ${JSON.stringify(root)}: ${reason(error)}`);
  }
  if (!rootStat?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const files: string[] = [];
  const notes: string[] = [];
  let symlinks = 0;
  let tooDeep = false;
  let truncated = false;

  const walk = (dir: string, prefix: string, depth: number): void => {
    let entries: DirEntry[];
    try {
      entries = fs.readdir(dir);
    } catch (error) {
      if (depth === 0) {
        throw new Error(`Cannot read folder ${JSON.stringify(root)}: ${reason(error)}`);
      }
      notes.push(`Skipped unreadable folder ${clean(prefix.slice(0, -1))} (${reason(error)}).`);
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) {
        symlinks += 1;
      } else if (entry.isFile()) {
        files.push(relative);
      } else if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) {
        if (depth < MAX_DEPTH) {
          walk(join(dir, entry.name), `${relative}/`, depth + 1);
        } else {
          tooDeep = true;
        }
      }
    }
  };
  walk(root, '', 0);
  files.sort();

  if (symlinks > 0) notes.push(`${symlinks} symbolic link(s) were not followed.`);
  if (tooDeep) notes.push(`Folders nested deeper than ${MAX_DEPTH} levels were not scanned.`);
  if (truncated) notes.push(`Stopped after ${MAX_FILES} files; later files were not scanned.`);

  const contents: Record<string, string> = {};
  for (const file of files) {
    if (!TEXT_FILE.test(file)) continue;
    const full = join(root, file);
    try {
      if ((fs.stat(full)?.size ?? 0) > MAX_TEXT_BYTES) {
        notes.push(`${clean(file)} is larger than ${MAX_TEXT_BYTES / 1024} KB and was not read.`);
        continue;
      }
      contents[file] = fs.readText(full);
    } catch (error) {
      notes.push(`Could not read ${clean(file)} (${reason(error)}).`);
    }
  }

  return { origin: root, files, contents, notes: notes.sort() };
}
