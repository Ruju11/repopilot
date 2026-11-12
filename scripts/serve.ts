import { readFileSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/* A tiny static file server for local use only: it listens on 127.0.0.1 and serves files below web/. */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Same as the policy in web/index.html, plus frame-ancestors, which a meta tag cannot carry. */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src https://api.github.com https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Maps a URL path to a candidate file below root by name only. Does not look at the disk. */
export function resolveStatic(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent((urlPath.split('?')[0] ?? '').split('#')[0] ?? '');
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const base = resolve(root);
  const full = resolve(base, decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''));
  if (!full.startsWith(base + sep)) return undefined;
  return Object.hasOwn(TYPES, extname(full)) ? full : undefined;
}

/**
 * Like resolveStatic, but also resolves symbolic links and Windows junctions with the real
 * path of both the root and the file, so a link inside web/ cannot expose a file outside it.
 * Returns the real path to read, or undefined if the file is missing or escapes the root.
 */
export function resolveServable(root: string, urlPath: string): string | undefined {
  const candidate = resolveStatic(root, urlPath);
  if (candidate === undefined) return undefined;
  try {
    const realRoot = realpathSync.native(root);
    const realFile = realpathSync.native(candidate);
    return realFile.startsWith(realRoot + sep) && Object.hasOwn(TYPES, extname(realFile)) ? realFile : undefined;
  } catch {
    return undefined; // missing file, link loop, no permission
  }
}

export function createStaticServer(root: string): Server {
  const notFound = (response: import('node:http').ServerResponse): void => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n');
  };
  return createServer((request, response) => {
    const allowed = request.method === 'GET' || request.method === 'HEAD';
    const file = allowed ? resolveServable(root, request.url ?? '/') : undefined;
    if (file === undefined) {
      notFound(response);
      return;
    }
    let data: Buffer;
    try {
      data = readFileSync(file);
    } catch {
      notFound(response);
      return;
    }
    response
      .writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      })
      .end(request.method === 'HEAD' ? undefined : data);
  });
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    process.stderr.write('Usage: node scripts/serve.ts [port 1024-65535]\n');
    process.exit(2);
  }
  createStaticServer(join(import.meta.dirname, '..', 'web')).listen(port, '127.0.0.1', () =>
    process.stdout.write(`RepoPilot demo: http://127.0.0.1:${port}/\n`),
  );
}
