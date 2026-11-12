import { analyze } from '../../src/core/analyze.ts';
import { SAMPLES } from './samples.ts';
import { toView, type ReportView } from './view.ts';

/* Everything is built with createElement and textContent. No HTML strings are ever parsed. */

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

const select = document.querySelector<HTMLSelectElement>('#sample');
const button = document.querySelector<HTMLButtonElement>('#run');
const description = document.querySelector<HTMLElement>('#description');
const result = document.querySelector<HTMLElement>('#result');
if (select === null || button === null || description === null || result === null) {
  throw new Error('The page structure changed.');
}

for (const sample of SAMPLES) {
  const option = make('option', sample.name);
  option.value = sample.id;
  select.append(option);
}

function show(): void {
  const sample = SAMPLES.find((item) => item.id === select?.value) ?? SAMPLES[0];
  if (sample === undefined || description === null || result === null) return;
  description.textContent = sample.description;
  render(toView(analyze(sample.snapshot)), result);
}

button.addEventListener('click', show);
select.addEventListener('change', show);
show();
