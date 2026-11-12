/** Replaces control characters so untrusted names cannot break lines or tables. */
export function clean(text: string): string {
  return text.replaceAll(/[\u0000-\u001f\u007f]/g, '?');
}

const TRUSTED_URL_BASE =
  /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}\/)[A-Za-z0-9._-]{1,100}\/blob\/[0-9a-f]{40}\/$/;

/** True only for a GitHub blob URL pinned to a full commit SHA. Anything else must not become a link. */
export function isTrustedUrlBase(value: string | undefined): value is string {
  return value !== undefined && TRUSTED_URL_BASE.test(value);
}

/** Percent-encodes each path segment; also encodes parentheses so Markdown links stay intact. */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/');
}
