/** Replaces control characters so untrusted names cannot break lines or tables. */
export function clean(text: string): string {
  return text.replaceAll(/[\u0000-\u001f\u007f]/g, '?');
}

/** Percent-encodes each path segment; also encodes parentheses so Markdown links stay intact. */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/');
}
