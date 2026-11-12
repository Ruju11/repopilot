import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/cli/main.ts';
import { analyze } from '../src/core/analyze.ts';
import { encodePath } from '../src/core/text.ts';
import { parseGithubTarget, readGithubRepo, type Fetcher, type HttpResponse } from '../src/sources/github.ts';

const TARGET = { owner: 'o', repo: 'r' };
const TREE_URL = 'https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1';
const raw = (path: string): string => `https://raw.githubusercontent.com/o/r/HEAD/${path}`;
const LONG_README = `# Demo\n\n${'This project does something useful. '.repeat(10)}`;

interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

function reply(route: Route): HttpResponse {
  const status = route.status ?? 200;
  const headers = new Map(Object.entries(route.headers ?? {}).map(([key, value]): [string, string] => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    text: async () => route.body ?? '',
  };
}

function fake(routes: Record<string, Route | Error>): { fetcher: Fetcher; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const route = routes[url];
    if (route instanceof Error) throw route;
    return reply(route ?? { status: 404 });
  };
  return { fetcher, calls };
}

const blob = (path: string, mode = '100644'): unknown => ({ path, mode, type: 'blob', sha: 'abc' });
const tree = (entries: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ sha: 'abc', tree: entries, truncated: false, ...extra });

async function cli(argv: string[], fetcher: Fetcher): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await run(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } }, fetcher);
  return { code, out, err };
}

test('repository names are parsed strictly', () => {
  for (const input of ['owner/repo', 'https://github.com/owner/repo', 'https://github.com/owner/repo.git', 'https://github.com/owner/repo/', 'my-org/some.repo_1']) {
    assert.deepEqual(parseGithubTarget(input), { owner: input.includes('my-org') ? 'my-org' : 'owner', repo: input.includes('my-org') ? 'some.repo_1' : 'repo' });
  }
  const bad = ['', 'owner', 'a/b/c', '../x', 'a/..', 'a/.', 'a b/c', '-a/b', 'a-/b', 'a/b?x=1', 'a/b#h', 'a/b%2f', 'a/b\nc', `${'x'.repeat(40)}/r`, `a/${'r'.repeat(101)}`, 'http://github.com/a/b', 'https://evil.test/a/b'];
  for (const input of bad) {
    assert.throws(() => parseGithubTarget(input), /Not a GitHub repository name/, JSON.stringify(input));
  }
});

test('a public repository becomes a snapshot using one API request and raw downloads', async () => {
  const { fetcher, calls } = fake({
    [TREE_URL]: { body: tree([blob('README.md'), blob('LICENSE'), blob('.github/workflows/ci.yml'), { path: 'src', type: 'tree', mode: '040000' }, blob('link', '120000'), { path: 'sub', type: 'commit', mode: '160000' }]), headers: { 'x-ratelimit-remaining': '50' } },
    [raw('README.md')]: { body: LONG_README },
    [raw('LICENSE')]: { body: 'MIT License\n\nPermission is hereby granted, free of charge' },
  });
  const snapshot = await readGithubRepo(TARGET, fetcher);
  assert.deepEqual(snapshot.files, ['.github/workflows/ci.yml', 'LICENSE', 'README.md']);
  assert.deepEqual(Object.keys(snapshot.contents).sort(), ['LICENSE', 'README.md']);
  assert.deepEqual(snapshot.notes, ['1 symbolic link(s) in the repository were not followed.']);
  assert.equal(snapshot.origin, 'github.com/o/r');
  assert.equal(snapshot.urlBase, 'https://github.com/o/r/blob/HEAD/');
  assert.deepEqual(calls.map((call) => call.url), [TREE_URL, raw('LICENSE'), raw('README.md')]);
  assert.equal(calls.filter((call) => call.url.startsWith('https://api.github.com/')).length, 1);
  const report = analyze(snapshot);
  assert.equal(report.findings.find((item) => item.id === 'ci')?.status, 'pass');
});

test('requests are read-only and carry no credentials, even if a token is set locally', async () => {
  const saved = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'sentinel-value-12345';
  try {
    const { fetcher, calls } = fake({ [TREE_URL]: { body: tree([blob('README.md')]) }, [raw('README.md')]: { body: 'x' } });
    await readGithubRepo(TARGET, fetcher);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const names = Object.keys(call.headers).map((name) => name.toLowerCase());
      assert.ok(!names.includes('authorization'), call.url);
      assert.ok(names.includes('user-agent'), call.url);
      assert.ok(new URL(call.url).host === 'api.github.com' || new URL(call.url).host === 'raw.githubusercontent.com');
    }
    assert.ok(!JSON.stringify(calls).includes('sentinel-value-12345'));
  } finally {
    if (saved === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved;
  }
});

test('HTTP failures become clear errors', async () => {
  const cases: Array<[Route, RegExp]> = [
    [{ status: 404 }, /o\/r was not found, or it is private/],
    [{ status: 301 }, /moved or been renamed/],
    [{ status: 403 }, /refused the request \(HTTP 403\)/],
    [{ status: 500 }, /HTTP 500/],
    [{ status: 429 }, /60 unauthenticated requests per hour/],
    [{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } }, new RegExp(`Resets at ${new Date(1_900_000_000 * 1000).toISOString()}`)],
  ];
  for (const [route, pattern] of cases) {
    await assert.rejects(readGithubRepo(TARGET, fake({ [TREE_URL]: route }).fetcher), pattern);
  }
});

test('a rate-limit error never suggests or uses a token', async () => {
  await assert.rejects(readGithubRepo(TARGET, fake({ [TREE_URL]: { status: 429 } }).fetcher), /does not use a token/);
});

test('network failures are reported without a stack trace', async () => {
  const failing = fake({ [TREE_URL]: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  await assert.rejects(readGithubRepo(TARGET, failing.fetcher), /^Error: Could not reach GitHub \(ECONNRESET\)\.$/);
});

test('malformed responses are rejected, odd entries are ignored', async () => {
  for (const body of ['', 'not json', 'null', '[]', '{"tree": 5}', '{"sha": "x"}']) {
    await assert.rejects(readGithubRepo(TARGET, fake({ [TREE_URL]: { body } }).fetcher), /could not read/, JSON.stringify(body));
  }
  const odd = tree([null, 5, 'text', { path: 1, type: 'blob' }, { type: 'blob' }, blob('README.md')]);
  const { fetcher } = fake({ [TREE_URL]: { body: odd }, [raw('README.md')]: { body: 'hello' } });
  assert.deepEqual((await readGithubRepo(TARGET, fetcher)).files, ['README.md']);
});

test('an empty repository gives an empty snapshot with a note', async () => {
  const snapshot = await readGithubRepo(TARGET, fake({ [TREE_URL]: { status: 409, body: '{"message":"Git Repository is empty."}' } }).fetcher);
  assert.deepEqual(snapshot.files, []);
  assert.deepEqual(snapshot.notes, ['The repository is empty.']);
});

test('shortened file lists and a low request allowance are reported', async () => {
  const { fetcher } = fake({ [TREE_URL]: { body: tree([blob('SECURITY.md')], { truncated: true }), headers: { 'x-ratelimit-remaining': '3' } } });
  const snapshot = await readGithubRepo(TARGET, fetcher);
  assert.equal(snapshot.notes.length, 2);
  assert.match(snapshot.notes.join(' '), /shortened the file list/);
  assert.match(snapshot.notes.join(' '), /Only 3 GitHub API request\(s\) remain/);
});

test('a failed or oversized README download is a note, not a failure', async () => {
  const missing = fake({ [TREE_URL]: { body: tree([blob('README.md')]) } });
  assert.deepEqual((await readGithubRepo(TARGET, missing.fetcher)).notes, ['Could not read README.md (HTTP 404).']);

  const broken = fake({ [TREE_URL]: { body: tree([blob('README.md')]) }, [raw('README.md')]: new Error('boom') });
  assert.match((await readGithubRepo(TARGET, broken.fetcher)).notes.join(' '), /Could not read README\.md \(Could not reach GitHub \(boom\)\.\)/);

  const huge = fake({ [TREE_URL]: { body: tree([blob('README.md')]) }, [raw('README.md')]: { body: 'x', headers: { 'content-length': String(300 * 1024) } } });
  const snapshot = await readGithubRepo(TARGET, huge.fetcher);
  assert.deepEqual(snapshot.notes, ['README.md is larger than 256 KB and was not read.']);
  assert.deepEqual(snapshot.contents, {});
});

test('at most five README or licence files are downloaded', async () => {
  const names = Array.from({ length: 8 }, (_, i) => `LICENSE-${i}`);
  const { fetcher, calls } = fake({ [TREE_URL]: { body: tree(names.map((name) => blob(name))) } });
  const snapshot = await readGithubRepo(TARGET, fetcher);
  assert.equal(calls.length, 1 + 5);
  assert.ok(snapshot.notes.includes('Only the first 5 README or licence files were read.'));
});

test('paths are encoded so they cannot break out of a URL or Markdown link', () => {
  assert.equal(encodePath('a b/(c)#.md'), 'a%20b/%28c%29%23.md');
});

test('check github:owner/repo links evidence to the file on GitHub', async () => {
  const { fetcher } = fake({
    [TREE_URL]: { body: tree([blob('README.md'), blob('SECURITY.md')]) },
    [raw('README.md')]: { body: LONG_README },
  });
  const result = await cli(['check', 'github:o/r'], fetcher);
  assert.equal(result.code, 1);
  assert.match(result.out, /^# RepoPilot report: github\.com\/o\/r/);
  assert.match(result.out, /\[`SECURITY\.md`\]\(https:\/\/github\.com\/o\/r\/blob\/HEAD\/SECURITY\.md\)/);
  const json = JSON.parse((await cli(['check', 'https://github.com/o/r', '--format', 'json'], fetcher)).out);
  assert.equal(json.urlBase, 'https://github.com/o/r/blob/HEAD/');
});

test('check github: reports GitHub failures with exit code 2 and no output on stdout', async () => {
  const result = await cli(['check', 'github:o/r'], fake({ [TREE_URL]: { status: 429 } }).fetcher);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.err, /60 unauthenticated requests per hour/);
});

test('hostile file names stay on one table row and are encoded in links', async () => {
  const nasty = '.github/workflows/a`b|c\nd.yml';
  const { fetcher } = fake({ [TREE_URL]: { body: tree([blob(nasty)]) } });
  const out = (await cli(['check', 'github:o/r'], fetcher)).out;
  const rows = out.split('\n').filter((line) => line.includes('Continuous integration'));
  assert.equal(rows.length, 1);
  const row = rows[0] ?? '';
  assert.match(row, /%0A/);
  assert.match(row, /%60/);
  assert.match(row, /%7C/);
  assert.ok(!row.includes('`b'));
});
