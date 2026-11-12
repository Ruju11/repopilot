import { analyze } from '../../src/core/analyze.ts';
import { parseGithubTarget, readGithubRepo } from '../../src/sources/github.ts';
import { SAMPLES } from './samples.ts';
import { toView, type ReportView } from './view.ts';

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

function render(view: ReportView, target: HTMLElement): void {
  const table = make('table');
  table.append(make('caption', `${view.origin}: ${view.summary}`));

  const head = make('tr');
  for (const title of ['Status', 'Check', 'Result', 'Evidence']) {
    const cell = make('th', title);
    cell.scope = 'col';
    head.append(cell);
  }
  const thead = make('thead');
  thead.append(head);
  table.append(thead);

  const body = make('tbody');
  for (const row of view.rows) {
    const tr = make('tr');
    tr.append(make('td', row.label, `status status-${row.status}`), make('td', row.title));

    const result = make('td', row.message);
    if (row.hint !== undefined) result.append(make('div', row.hint, 'hint'));
    tr.append(result);

    const evidence = make('td');
    if (row.evidence.length === 0) {
      evidence.append(make('span', `Searched: ${row.searched}`, 'muted'));
    }
    for (const item of row.evidence) {
      const code = make('code', item.text);
      if (item.href === undefined) {
        evidence.append(code, ' ');
      } else {
        const link = make('a');
        link.href = item.href;
        link.rel = 'noopener noreferrer';
        link.append(code);
        evidence.append(link, ' ');
      }
    }
    tr.append(evidence);
    body.append(tr);
  }
  table.append(body);

  const wrapper = make('div', '', 'scroll');
  wrapper.append(table);
  const parts: HTMLElement[] = [wrapper];
  if (view.notes.length > 0) {
    const list = make('ul');
    for (const note of view.notes) list.append(make('li', note));
    parts.push(make('h2', 'Notes'), list);
  }
  target.replaceChildren(...parts);
}

function find<T extends Element>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`The page structure changed: ${selector}`);
  return node;
}

// --- sample reports (synthetic data, no network) ---

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
  render(toView(analyze(sample.snapshot)), sampleResult);
}

runButton.addEventListener('click', showSample);
select.addEventListener('change', showSample);
showSample();

// --- live scan of a public GitHub repository ---

const form = find('#live-form', HTMLFormElement);
const repoInput = find('#repo', HTMLInputElement);
const scanButton = find('#scan', HTMLButtonElement);
const status = find('#live-status', HTMLElement);
const liveResult = find('#live-result', HTMLElement);
let scanning = false;

function setStatus(text: string, isError = false): void {
  status.textContent = isError ? `Error: ${text}` : text;
  status.className = isError ? 'error' : '';
}

async function scan(): Promise<void> {
  if (scanning) return;
  repoInput.removeAttribute('aria-invalid');
  let target;
  try {
    target = parseGithubTarget(repoInput.value); // validated before any network request
  } catch (error) {
    liveResult.replaceChildren();
    repoInput.setAttribute('aria-invalid', 'true');
    setStatus(error instanceof Error ? error.message : 'Enter a repository as owner/repo.', true);
    return;
  }
  scanning = true;
  scanButton.disabled = true;
  liveResult.setAttribute('aria-busy', 'true');
  liveResult.replaceChildren();
  setStatus(`Scanning ${target.owner}/${target.repo}...`);
  try {
    const snapshot = await readGithubRepo(target, undefined, { client: 'browser' });
    const view = toView(analyze(snapshot));
    render(view, liveResult);
    const left = snapshot.apiRemaining === undefined ? '' : ` GitHub requests left this hour: ${snapshot.apiRemaining}.`;
    setStatus(`Scan finished. ${view.origin}: ${view.summary}.${left}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The scan failed.', true);
  } finally {
    scanning = false;
    scanButton.disabled = false;
    liveResult.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void scan();
});
repoInput.addEventListener('input', () => repoInput.removeAttribute('aria-invalid'));
