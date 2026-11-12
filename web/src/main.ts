import { analyze } from '../../src/core/analyze.ts';
import { clean } from '../../src/core/text.ts';
import type { Status } from '../../src/core/types.ts';
import { parseGithubTarget, readGithubRepo } from '../../src/sources/github.ts';
import { SAMPLES } from './samples.ts';
import { explainError, groupRows, STATUS_HEADING, STATUS_ORDER, toView, type ReportView, type RowView } from './view.ts';

/*
 * Everything is built with createElement and textContent: no HTML string is ever parsed.
 * The only network path is readGithubRepo (unauthenticated, read-only, two allowed hosts).
 */

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className !== '') node.className = className;
  return node;
}

function find<T extends Element>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`The page structure changed: ${selector}`);
  return node;
}

// ---- report rendering ----

const GLYPH: Record<Status, string> = { fail: '✕', warn: '!', pass: '✓', 'not-applicable': '–' };

function badge(row: RowView): HTMLElement {
  const badgeNode = make('span', '', `status status-${row.status}`);
  const glyph = make('span', GLYPH[row.status], 'glyph');
  glyph.setAttribute('aria-hidden', 'true');
  badgeNode.append(glyph, make('span', row.label));
  return badgeNode;
}

function cell(label: string, ...children: Array<Node | string>): HTMLTableCellElement {
  const td = make('td');
  td.dataset.label = label;
  td.append(...children);
  return td;
}

function findingsTable(rows: RowView[]): HTMLElement {
  const table = make('table');
  const head = make('tr');
  for (const title of ['Status', 'Check', 'Result', 'Evidence']) {
    const th = make('th', title);
    th.scope = 'col';
    head.append(th);
  }
  const thead = make('thead');
  thead.append(head);
  table.append(thead);

  const body = make('tbody');
  for (const row of rows) {
    const result = make('div');
    result.append(make('p', row.message));
    if (row.hint !== undefined) {
      const fix = make('p', '', 'fix');
      fix.append(make('strong', 'How to fix: '), row.hint);
      result.append(fix);
    }

    const evidence = make('div', '', 'evidence-list');
    if (row.evidence.length === 0) {
      evidence.append(make('span', `Searched: ${row.searched}`, 'muted'));
    }
    for (const item of row.evidence) {
      const code = make('code', item.text);
      if (item.href === undefined) {
        evidence.append(code);
      } else {
        const link = make('a');
        link.href = item.href;
        link.rel = 'noopener noreferrer';
        link.append(code);
        evidence.append(link);
      }
    }

    const tr = make('tr');
    tr.append(cell('Status', badge(row)), cell('Check', row.title), cell('Result', result), cell('Evidence', evidence));
    body.append(tr);
  }
  table.append(body);

  const wrapper = make('div', '', 'scroll');
  wrapper.append(table);
  return wrapper;
}

function repositoryMap(files: readonly string[]): HTMLElement {
  const section = make('section', '', 'panel repo-map');
  section.append(make('h4', 'Repository map'), make('p', `${files.length.toLocaleString()} files in the scan snapshot`, 'hint'));
  if (files.length === 0) return section;

  // Group by the first directory. An empty key holds files at the root.
  const groups = new Map<string, string[]>();
  for (const path of files) {
    const slash = path.indexOf('/');
    const key = slash === -1 ? '' : path.slice(0, slash);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [path]);
    else group.push(path);
  }

  const label = make('label', 'Browse top-level folders');
  const select = make('select');
  select.id = 'map-folder';
  label.htmlFor = select.id;
  const folders = [...groups.keys()].sort();
  for (const folder of folders) {
    const name = folder === '' ? 'Root files' : `${clean(folder)}/`;
    const option = make('option', `${name} (${groups.get(folder)?.length ?? 0})`);
    option.value = folder;
    select.append(option);
  }

  const list = make('ul', '', 'map-files');
  const shown = make('p', '', 'hint');
  shown.setAttribute('role', 'status');
  const more = make('button', 'Show more files', 'button');
  more.type = 'button';
  const pageSize = 12;
  let visible = 0;
  function appendFiles(): void {
    const paths = groups.get(select.value) ?? [];
    for (const path of paths.slice(visible, visible + pageSize)) {
      const item = make('li');
      item.append(make('code', clean(path)));
      list.append(item);
    }
    visible = list.childElementCount;
    shown.textContent = `Showing ${visible.toLocaleString()} of ${paths.length.toLocaleString()} files`;
    more.hidden = visible >= paths.length;
  }
  select.addEventListener('change', () => {
    visible = 0;
    list.replaceChildren();
    appendFiles();
  });
  more.addEventListener('click', () => {
    appendFiles();
    if (more.hidden) select.focus();
  });
  section.append(label, select, list, shown, more);
  appendFiles();
  return section;
}

/** Renders a report and returns its heading so the caller can move focus to it. */
function renderReport(view: ReportView, target: HTMLElement, extra?: string, files?: readonly string[]): HTMLElement {
  const title = make('h3', view.origin, 'report-title');
  title.tabIndex = -1;
  const head = make('header', '', 'report-head');
  head.append(title);

  const meta = make('p', '', 'report-meta');
  if (view.commitHref !== undefined) {
    const link = make('a', 'View the scanned commit on GitHub');
    link.href = view.commitHref;
    link.rel = 'noopener noreferrer';
    meta.append(link);
  }
  if (extra !== undefined) meta.append(view.commitHref === undefined ? extra : ` · ${extra}`);
  if (meta.childNodes.length > 0) head.append(meta);

  const counts = make('ul', '', 'counts');
  counts.setAttribute('aria-label', 'Result counts');
  for (const status of STATUS_ORDER) {
    const n = view.rows.filter((row) => row.status === status).length;
    const count = make('li', '', `count count-${status}`);
    count.append(make('span', STATUS_HEADING[status]), make('strong', String(n)));
    counts.append(count);
  }
  head.append(counts);

  const parts: HTMLElement[] = [head];
  if (files !== undefined) parts.push(repositoryMap(files));
  parts.push(make('h4', 'Findings', 'findings-title'));
  for (const group of groupRows(view.rows)) {
    const heading = `${STATUS_HEADING[group.status]} (${group.rows.length})`;
    if (group.status === 'fail' || group.status === 'warn') {
      const section = make('section', '', 'group');
      section.append(make('h5', heading, 'group-title'), findingsTable(group.rows));
      parts.push(section);
    } else {
      const details = make('details', '', 'group');
      details.append(make('summary', heading), findingsTable(group.rows));
      parts.push(details);
    }
  }
  if (view.notes.length > 0) {
    const notes = make('section', '', 'notes');
    const list = make('ul');
    for (const note of view.notes) list.append(make('li', note));
    notes.append(make('h4', 'Scan notes'), list);
    parts.push(notes);
  }
  target.replaceChildren(...parts);
  return title;
}

function stateCard(title: string, body: string, className = ''): HTMLElement {
  const card = make('div', '', `state ${className}`.trim());
  card.append(make('h3', title), make('p', body));
  return card;
}

// ---- sample reports (synthetic data, no network) ----

const select = find('#sample', HTMLSelectElement);
const runButton = find('#run', HTMLButtonElement);
const description = find('#description', HTMLElement);
const sampleResult = find('#result', HTMLElement);

for (const sample of SAMPLES) {
  const option = make('option', sample.name);
  option.value = sample.id;
  select.append(option);
}

function showSample(): void {
  const sample = SAMPLES.find((item) => item.id === select.value) ?? SAMPLES[0];
  if (sample === undefined) return;
  description.textContent = sample.description;
  renderReport(toView(analyze(sample.snapshot)), sampleResult, 'synthetic sample');
}

runButton.addEventListener('click', showSample);
select.addEventListener('change', showSample);
find('#samples', HTMLDetailsElement).addEventListener('toggle', (event) => {
  if (event.currentTarget instanceof HTMLDetailsElement && event.currentTarget.open && !sampleResult.hasChildNodes()) showSample();
});

// ---- what it checks (generated from the same checks the scan runs) ----

const checkList = find('#check-list', HTMLElement);
for (const finding of analyze({ origin: '', files: [], contents: {}, notes: [] }).findings) {
  const item = make('div');
  item.append(make('dt', finding.title), make('dd', `Looks for: ${finding.searched.join(', ')}`));
  checkList.append(item);
}

// ---- live scan of a public GitHub repository ----

const form = find('#live-form', HTMLFormElement);
const repoInput = find('#repo', HTMLInputElement);
const scanButton = find('#scan-button', HTMLButtonElement);
const fieldError = find('#repo-error', HTMLElement);
const status = find('#live-status', HTMLElement);
const liveResult = find('#live-result', HTMLElement);
let scanning = false;

function showEmpty(): void {
  liveResult.replaceChildren(
    stateCard('No scan yet', 'Enter a repository as owner/repo, or use one of the examples above. The report appears here, with the file behind each result.'),
  );
}

function clearFieldError(): void {
  fieldError.hidden = true;
  fieldError.textContent = '';
  repoInput.removeAttribute('aria-invalid');
}

function showLoading(name: string): void {
  const card = stateCard('Reading the repository', `Looking up ${name} on GitHub. This usually takes a few seconds.`);
  card.append(make('div', '', 'busy-bar'));
  liveResult.replaceChildren(card);
}

function showError(message: string): void {
  const view = explainError(message);
  const card = make('div', '', 'state state-error');
  card.setAttribute('role', 'alert');
  card.append(make('h3', view.title), make('p', view.advice), make('p', message, 'detail'));
  if (view.retry) {
    const retry = make('button', 'Try again', 'button');
    retry.type = 'button';
    retry.addEventListener('click', () => void scan());
    card.append(retry);
  }
  liveResult.replaceChildren(card);
  status.textContent = '';
}

async function scan(): Promise<void> {
  if (scanning) return;
  clearFieldError();
  let target;
  try {
    target = parseGithubTarget(repoInput.value); // validated before any network request
  } catch (error) {
    fieldError.textContent = error instanceof Error ? error.message : 'Enter a repository as owner/repo.';
    fieldError.hidden = false;
    repoInput.setAttribute('aria-invalid', 'true');
    repoInput.focus();
    return;
  }
  const name = `${target.owner}/${target.repo}`;
  scanning = true;
  scanButton.setAttribute('aria-disabled', 'true');
  scanButton.textContent = 'Scanning...';
  liveResult.setAttribute('aria-busy', 'true');
  status.textContent = `Scanning ${name}...`;
  showLoading(name);
  try {
    const snapshot = await readGithubRepo(target, undefined, { client: 'browser' });
    const view = toView(analyze(snapshot));
    const left = snapshot.apiRemaining === undefined ? undefined : `GitHub requests left this hour: ${snapshot.apiRemaining}`;
    const heading = renderReport(view, liveResult, left, snapshot.files);
    status.textContent = `Scan finished. ${view.origin}: ${view.summary}.${left === undefined ? '' : ` ${left}.`}`;
    heading.focus();
  } catch (error) {
    showError(error instanceof Error ? error.message : 'The scan failed.');
  } finally {
    scanning = false;
    scanButton.removeAttribute('aria-disabled');
    scanButton.textContent = 'Scan repository';
    liveResult.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void scan();
});
repoInput.addEventListener('input', clearFieldError);

for (const example of document.querySelectorAll<HTMLButtonElement>('button[data-repo]')) {
  example.addEventListener('click', () => {
    repoInput.value = example.dataset.repo ?? '';
    clearFieldError();
    repoInput.focus();
  });
}

// Keyboard: "/" jumps to the field from anywhere; Escape clears it.
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  if (typing) return;
  event.preventDefault();
  repoInput.focus();
  repoInput.select();
});

repoInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && repoInput.value !== '') {
    repoInput.value = '';
    clearFieldError();
  }
});

showEmpty();

// ---- workspace navigation ----

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-list a');
function updateCurrentLocation(): void {
  const location = window.location.hash || '#scan';
  for (const link of navLinks) {
    if (link.hash === location) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', updateCurrentLocation);
updateCurrentLocation();

const sourceLink = make('a', 'Source code on GitHub');
sourceLink.href = 'https://github.com/Ruju11/repopilot';
sourceLink.rel = 'noopener noreferrer';
find('#source-link', HTMLElement).append(sourceLink);
