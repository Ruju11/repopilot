import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/* A tiny static file server for local use only: it listens on 127.0.0.1 and serves files below web/. */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Maps a URL path to a servable file below root, or undefined. Never leaves root. */
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

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    process.stderr.write('Usage: node scripts/serve.ts [port 1024-65535]\n');
    process.exit(2);
  }
  const root = join(import.meta.dirname, '..', 'web');
  createServer((request, response) => {
    const file = request.method === 'GET' || request.method === 'HEAD' ? resolveStatic(root, request.url ?? '/') : undefined;
    if (file === undefined) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n');
      return;
    }
    readFile(file).then(
      (data) => {
        response
          .writeHead(200, {
            'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
            'Content-Security-Policy': CSP,
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store',
          })
          .end(request.method === 'HEAD' ? undefined : data);
      },
      () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n');
      },
    );
  }).listen(port, '127.0.0.1', () => process.stdout.write(`RepoPilot demo: http://127.0.0.1:${port}/\n`));
}
