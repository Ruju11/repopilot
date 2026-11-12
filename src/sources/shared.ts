export const MAX_FILES = 20_000;
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_TEXT_FILES = 5;

/** Root-level files whose text the checks need. */
export const TEXT_FILE = /^(?:readme|licen[sc]e|copying)(?:[.-][a-z0-9.-]+)?$/i;

/** A short, safe description of an error: its code if it has one, else its message. */
export function reason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}
