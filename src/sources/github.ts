import { clean, encodePath } from '../core/text.ts';
import type { RepoSnapshot } from '../core/types.ts';
import { MAX_FILES, MAX_TEXT_BYTES, MAX_TEXT_FILES, reason, TEXT_FILE } from './shared.ts';

/*
 * Read-only access to PUBLIC repositories through GitHub's unauthenticated API.
 * No token is ever read, sent or logged.
 *
 * One run resolves the default branch to a commit SHA once, then reads the file
 * list and the README/licence texts from that exact commit, and links evidence to it.
 * Cost: 2 API requests (GitHub allows 60 per hour per IP address) plus up to 5
 * downloads from raw.githubusercontent.com. Response sizes are capped by counting
 * bytes as they stream in; a response that crosses the cap is cancelled.
 */

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const TIMEOUT_MS = 10_000;
const MAX_TREE_BYTES = 16 * 1024 * 1024;
const MAX_SHA_BYTES = 200;
const LOW_QUOTA = 5;
const SHA = /^[0-9a-f]{40}$/;

export interface GithubTarget {
  owner: string;
  repo: string;
}

export interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: { getReader(): BodyReader } | null;
}

export interface HttpInit {
  headers: Record<string, string>;
  redirect: 'manual';
  /** Never send cookies or other credentials. */
  credentials: 'omit';
  referrerPolicy: 'no-referrer';
  signal: AbortSignal;
}

export interface ReadOptions {
  /**
   * "browser" sends only the Accept header, which a browser may set without a CORS preflight
   * (User-Agent cannot be set by a page, and X-GitHub-Api-Version would trigger a preflight).
   */
  client?: 'node' | 'browser';
}

export type Fetcher = (url: string, init: HttpInit) => Promise<HttpResponse>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts "owner/repo" or "https://github.com/owner/repo" (optionally ending in .git). */
export function parseGithubTarget(input: string): GithubTarget {
  const trimmed = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const parts = trimmed.split('/');
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    !OWNER.test(owner) ||
    !REPO.test(repo) ||
    repo === '.' ||
    repo === '..'
  ) {
    throw new Error(`Not a GitHub repository name: ${JSON.stringify(clean(input).slice(0, 100))}. Use owner/repo.`);
  }
  return { owner, repo };
}

interface Reply {
  status: number;
  ok: boolean;
  tooLarge: boolean;
  body: string;
  remaining: string | null;
  reset: string | null;
}

/** Reads a body, counting bytes as they arrive. Cancels the read once the cap is crossed. */
async function readCapped(body: HttpResponse['body'], maxBytes: number): Promise<{ text: string; tooLarge: boolean }> {
  if (body === null) return { text: '', tooLarge: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { text: '', tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}

async function fetchText(
  fetcher: Fetcher,
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<Reply> {
  try {
    const response = await fetcher(url, {
      headers,
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const reply = {
      status: response.status,
      ok: response.ok,
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    };
    if (!response.ok) return { ...reply, tooLarge: false, body: '' };
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) return { ...reply, tooLarge: true, body: '' };
    const { text, tooLarge } = await readCapped(response.body, maxBytes);
    return { ...reply, tooLarge, body: text };
  } catch (error) {
    throw new Error(`Could not reach GitHub (${reason(error)}).`);
  }
}

const unreadable = (): Error => new Error('GitHub sent a response RepoPilot could not read.');

function httpError(reply: Reply, repoName: string): Error {
  if (reply.status === 429 || (reply.status === 403 && reply.remaining === '0')) {
    const reset = Number(reply.reset);
    const when = Number.isFinite(reset) && reset > 0 ? ` Resets at ${new Date(reset * 1000).toISOString()}.` : '';
    return new Error(`GitHub's limit of 60 unauthenticated requests per hour was reached.${when} RepoPilot does not use a token.`);
  }
  switch (reply.status) {
    case 0: // a browser reports a blocked redirect as status 0
      return new Error('GitHub answered with a redirect; the repository may have been renamed or moved.');
    case 404:
      return new Error(`${repoName} was not found, or it is private. Only public repositories are supported.`);
    case 301:
      return new Error(`${repoName} has moved or been renamed. Use its new name.`);
    case 403:
      return new Error('GitHub refused the request (HTTP 403).');
    default:
      return new Error(`GitHub returned HTTP ${reply.status}.`);
  }
}

interface TreeEntry {
  path: string;
  type: string;
  mode: string | undefined;
}

function parseTree(body: string): { entries: TreeEntry[]; truncated: boolean } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw unreadable();
  }
  if (typeof data !== 'object' || data === null || !('tree' in data) || !Array.isArray(data.tree)) {
    throw unreadable();
  }
  const entries: TreeEntry[] = [];
  for (const item of data.tree as unknown[]) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'path' in item &&
      'type' in item &&
      typeof item.path === 'string' &&
      typeof item.type === 'string'
    ) {
      entries.push({ path: item.path, type: item.type, mode: 'mode' in item && typeof item.mode === 'string' ? item.mode : undefined });
    }
  }
  return { entries, truncated: 'truncated' in data && data.truncated === true };
}

/** Builds a snapshot of a public repository's default branch, pinned to one commit. Read-only. */
export async function readGithubRepo(
  target: GithubTarget,
  fetcher: Fetcher = defaultFetcher,
  options: ReadOptions = {},
): Promise<RepoSnapshot> {
  const name = `${target.owner}/${target.repo}`;
  const notes: string[] = [];
  const browser = options.client === 'browser';
  const apiHeaders: Record<string, string> = browser
    ? { Accept: 'application/vnd.github+json' }
    : { Accept: 'application/vnd.github+json', 'User-Agent': 'repopilot', 'X-GitHub-Api-Version': '2022-11-28' };
  const rawHeaders: Record<string, string> = browser ? {} : { 'User-Agent': 'repopilot' };

  // Resolve the default branch to a commit once; everything below is pinned to it.
  const head = await fetchText(
    fetcher,
    `${API}/repos/${name}/commits/HEAD`,
    { ...apiHeaders, Accept: 'application/vnd.github.sha' },
    MAX_SHA_BYTES,
  );
  if (head.status === 409) {
    return { origin: `github.com/${name}`, files: [], contents: {}, notes: ['The repository is empty.'] };
  }
  if (!head.ok) throw httpError(head, name);
  const sha = head.body.trim();
  if (head.tooLarge || !SHA.test(sha)) throw unreadable();

  const listing = await fetchText(fetcher, `${API}/repos/${name}/git/trees/${sha}?recursive=1`, apiHeaders, MAX_TREE_BYTES);
  if (listing.tooLarge) throw new Error('GitHub sent a file list too large to read.');
  if (!listing.ok) throw httpError(listing, name);

  const { entries, truncated } = parseTree(listing.body);
  const blobs = entries.filter((entry) => entry.type === 'blob');
  const links = blobs.filter((entry) => entry.mode === '120000').length;
  let files = blobs.filter((entry) => entry.mode !== '120000').map((entry) => entry.path);
  if (links > 0) notes.push(`${links} symbolic link(s) in the repository were not followed.`);
  if (truncated) notes.push('GitHub shortened the file list (very large repository); some files may be missing from this report.');
  if (files.length > MAX_FILES) {
    files = files.slice(0, MAX_FILES);
    notes.push(`Only the first ${MAX_FILES} files were used.`);
  }
  files.sort();

  const left = listing.remaining === null ? Number.NaN : Number(listing.remaining);
  if (left <= LOW_QUOTA) notes.push(`Only ${left} GitHub API request(s) remain in this hour's allowance.`);

  const wanted = files.filter((file) => TEXT_FILE.test(file));
  if (wanted.length > MAX_TEXT_FILES) {
    notes.push(`Only the first ${MAX_TEXT_FILES} README or licence files were read.`);
  }
  const contents: Record<string, string> = {};
  for (const file of wanted.slice(0, MAX_TEXT_FILES)) {
    try {
      const raw = await fetchText(fetcher, `${RAW}/${name}/${sha}/${encodePath(file)}`, rawHeaders, MAX_TEXT_BYTES);
      if (raw.tooLarge) {
        notes.push(`${clean(file)} is larger than ${MAX_TEXT_BYTES / 1024} KB and was not read.`);
      } else if (!raw.ok) {
        notes.push(`Could not read ${clean(file)} (HTTP ${raw.status}).`);
      } else {
        contents[file] = raw.body;
      }
    } catch (error) {
      notes.push(`Could not read ${clean(file)} (${error instanceof Error ? error.message : 'unknown error'}).`);
    }
  }

  return {
    origin: `github.com/${name}@${sha.slice(0, 7)}`,
    files,
    contents,
    notes,
    urlBase: `https://github.com/${name}/blob/${sha}/`,
    apiRemaining: Number.isFinite(left) ? left : undefined,
  };
}
