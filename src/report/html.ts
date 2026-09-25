import { diffTapes, type DiffOptions, type TapeDiff } from '../diff/diff.js';
import type { Tape } from '../tape/schema.js';
import { VERSION } from '../version.js';
import { diffReportData, tapeReportData, type ReportData } from './data.js';

const DARK_TOKENS = `
    --bg: #151517; --panel: #1e1e21; --text: #ececee; --muted: #9a9aa2; --border: #303036;
    --llm: #6ea2ff; --tool: #f0a73b; --clock: #9a9aa2; --random: #b294ff;
    --ok: #4cc47f; --warn: #f0a73b; --bad: #ff6b60;
    --ok-bg: #173323; --warn-bg: #3a2c12; --bad-bg: #3d1a18; --code-bg: #26262a;
    color-scheme: dark;`;

// Light by default, dark when the OS asks for it, and an explicit
// data-theme="light"/"dark" on <html> (set by embedding viewers) wins both ways.
const CSS = /* css */ `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --border: #e2e2e0;
  --llm: #2f6fdb; --tool: #b86e00; --clock: #6b6b70; --random: #7a4fd0;
  --ok: #1f8a4c; --warn: #b86e00; --bad: #c9372c;
  --ok-bg: #e8f5ec; --warn-bg: #fdf3e2; --bad-bg: #fbeaea; --code-bg: #f1f1ef;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKENS}
  }
}
:root[data-theme="dark"] {${DARK_TOKENS}
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 10px; }
.muted { color: var(--muted); }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.brand { color: var(--muted); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 6px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 6px 0 0; }
.card dt { color: var(--muted); }
.card dd { margin: 0; overflow-wrap: anywhere; }
.banner { border-radius: 10px; padding: 12px 14px; margin-top: 16px; border: 1px solid var(--border); }
.banner.ok { background: var(--ok-bg); }
.banner.warn { background: var(--warn-bg); }
.banner pre { margin: 6px 0 0; white-space: pre-wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { border: 1px solid var(--border); background: var(--panel); border-radius: 999px; padding: 2px 10px; font-size: 12.5px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 8px 0 12px; }
.toolbar label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
button { font: inherit; border: 1px solid var(--border); background: var(--panel); color: var(--text);
  border-radius: 8px; padding: 4px 12px; cursor: pointer; }
button:hover { border-color: var(--muted); }
.list { display: flex; flex-direction: column; gap: 6px; }
details.event { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--clock); border-radius: 8px; min-width: 0; }
details.event > summary { list-style: none; cursor: pointer; padding: 7px 10px; display: flex; gap: 10px; align-items: baseline; min-width: 0; }
details.event > summary::-webkit-details-marker { display: none; }
details.event[open] > summary { border-bottom: 1px solid var(--border); }
details.event pre { margin: 0; padding: 10px; background: var(--code-bg); overflow-x: auto; max-height: 420px; border-radius: 0 0 8px 8px; }
.type-llm_call { border-left-color: var(--llm) !important; }
.type-tool_call, .type-tool_result { border-left-color: var(--tool) !important; }
.type-random_draw { border-left-color: var(--random) !important; }
.seq, .time, .dur { color: var(--muted); white-space: nowrap; }
.time { min-width: 64px; text-align: right; }
.badge { font-size: 11.5px; font-weight: 600; white-space: nowrap; min-width: 84px; }
.badge.llm_call { color: var(--llm); } .badge.tool_call, .badge.tool_result { color: var(--tool); }
.badge.clock_read { color: var(--clock); } .badge.random_draw { color: var(--random); }
.summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: 8px; }
.step.first { outline: 2px solid var(--warn); outline-offset: 2px; }
.step-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding: 0 4px 6px; }
.step-head .mono { overflow-wrap: anywhere; min-width: 0; }
.mark { font-weight: 700; width: 1.2em; text-align: center; }
.status-match .mark, .status-added .mark { color: var(--ok); }
.status-changed .mark { color: var(--warn); }
.status-removed .mark { color: var(--bad); }
.status-changed { background: var(--warn-bg); }
.status-added { background: var(--ok-bg); }
.status-removed { background: var(--bad-bg); }
.sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.sides > div { min-width: 0; }
.side-label { font-size: 11px; color: var(--muted); margin: 0 0 3px 2px; }
.absent { border: 1px dashed var(--border); border-radius: 8px; padding: 7px 10px; color: var(--muted); }
ul.changes { margin: 8px 4px 2px; padding-left: 18px; }
ul.changes li { overflow-wrap: anywhere; }
.hidden { display: none !important; }
@media (max-width: 700px) { .sides { grid-template-columns: 1fr; } .time { display: none; } }
`;

const SCRIPT = /* js */ `
(function () {
  var data = JSON.parse(document.getElementById('tapedeck-data').textContent);
  var root = document.getElementById('app');

  function el(tag, attrs) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) {
      var value = attrs[key];
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.append(child instanceof Node ? child : String(child));
  }

  function tapeCard(label, t) {
    return el('div', { class: 'card' },
      el('div', { class: 'muted' }, label),
      el('strong', null, t.name),
      el('dl', null,
        el('dt', null, 'Tape ID'), el('dd', { class: 'mono' }, t.id),
        el('dt', null, 'Recorded'), el('dd', null, t.createdAt),
        t.command ? [el('dt', null, 'Command'), el('dd', { class: 'mono' }, t.command)] : null,
        el('dt', null, 'Events'), el('dd', null, t.eventCount),
        el('dt', null, 'Outcome'), el('dd', null, t.outcome)));
  }

  function eventRow(ev) {
    return el('details', { class: 'event type-' + ev.type, 'data-type': ev.type },
      el('summary', null,
        el('span', { class: 'seq mono' }, '#' + ev.seq),
        el('span', { class: 'time mono' }, '+' + ev.t + 'ms'),
        el('span', { class: 'badge mono ' + ev.type }, ev.type),
        el('span', { class: 'summary', title: ev.summary }, ev.summary),
        ev.durationMs ? el('span', { class: 'dur mono' }, ev.durationMs + 'ms') : null),
      el('pre', null, JSON.stringify(Object.assign({ id: ev.id }, ev.detail), null, 2)));
  }

  function renderTape() {
    var counts = {};
    data.events.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
    var hidden = {};
    var list = el('div', { class: 'list' }, data.events.map(eventRow));
    if (!data.events.length) list.append(el('div', { class: 'absent' }, 'This tape has no events.'));
    function refresh() {
      Array.prototype.forEach.call(list.children, function (row) {
        row.classList.toggle('hidden', !!hidden[row.getAttribute('data-type')]);
      });
    }
    var filters = Object.keys(counts).map(function (type) {
      return el('label', null,
        el('input', { type: 'checkbox', checked: true, onchange: function (e) { hidden[type] = !e.target.checked; refresh(); } }),
        el('span', { class: 'badge mono ' + type }, type), el('span', { class: 'muted' }, counts[type]));
    });
    root.append(
      el('div', { class: 'brand' }, 'TapeDeck · tape'),
      el('h1', null, data.tape.name),
      el('div', { class: 'cards' }, tapeCard('Recording', data.tape)),
      el('h2', null, 'Timeline'),
      el('div', { class: 'toolbar' }, filters,
        el('button', { onclick: function () { list.querySelectorAll('details').forEach(function (d) { d.open = true; }); } }, 'Expand all'),
        el('button', { onclick: function () { list.querySelectorAll('details').forEach(function (d) { d.open = false; }); } }, 'Collapse all')),
      list);
  }

  var MARKS = { match: '\\u2713', changed: '~', added: '+', removed: '\\u2212' };

  function side(label, ev, missing) {
    return el('div', null, el('div', { class: 'side-label' }, label),
      ev ? eventRow(ev) : el('div', { class: 'absent' }, missing));
  }

  function renderDiff() {
    var list = el('div', { class: 'list' }, data.steps.map(function (s) {
      return el('div', {
          class: 'step status-' + s.status + (s.index === data.firstDivergence ? ' first' : ''),
          id: 'step-' + (s.index + 1), 'data-status': s.status },
        el('div', { class: 'step-head' },
          el('span', { class: 'mark mono' }, MARKS[s.status]),
          el('strong', null, 'Step ' + (s.index + 1)),
          el('span', { class: 'mono muted' }, s.key),
          el('span', { class: 'muted' }, s.status)),
        el('div', { class: 'sides' },
          side('A · baseline', s.a, 'not in A'),
          side('B · new run', s.b, 'not in B')),
        s.changes.length ? el('ul', { class: 'changes mono' }, s.changes.map(function (c) { return el('li', null, c); })) : null);
    }));
    if (!data.steps.length) list.append(el('div', { class: 'absent' }, 'Neither tape has events.'));

    var showMatches = el('input', { type: 'checkbox', checked: true, onchange: function (e) {
      list.querySelectorAll('[data-status="match"]').forEach(function (n) { n.classList.toggle('hidden', !e.target.checked); });
    } });
    var st = data.stats;
    root.append(
      el('div', { class: 'brand' }, 'TapeDeck · diff'),
      el('h1', null, data.equal ? 'Runs match' : 'Runs diverge'),
      el('div', { class: 'cards' }, tapeCard('A · baseline', data.a), tapeCard('B · new run', data.b)),
      el('div', { class: 'banner ' + (data.equal ? 'ok' : 'warn') }, el('strong', null, data.equal ? 'No differences' : 'First point of divergence'),
        el('pre', null, data.summary)),
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, st.matched + ' matched'), el('span', { class: 'chip' }, st.changed + ' changed'),
        el('span', { class: 'chip' }, st.added + ' added'), el('span', { class: 'chip' }, st.removed + ' removed'),
        el('span', { class: 'chip' }, 'outcome ' + data.outcome.status)),
      el('h2', null, 'Steps'),
      el('div', { class: 'toolbar' },
        el('label', null, showMatches, 'Show matching steps'),
        data.firstDivergence != null ? el('button', { onclick: function () {
          document.getElementById('step-' + (data.firstDivergence + 1)).scrollIntoView({ behavior: 'smooth', block: 'center' });
        } }, 'Jump to first divergence') : null),
      list,
      el('h2', null, 'Outcome'),
      el('div', { class: 'card' }, el('div', null, 'A: ' + data.a.outcome), el('div', null, 'B: ' + data.b.outcome),
        data.outcome.changes.length ? el('ul', { class: 'changes mono' }, data.outcome.changes.map(function (c) { return el('li', null, c); })) : null));
  }

  if (data.kind === 'tape') renderTape(); else renderDiff();
})();
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Characters that must not appear raw inside a <script> element. */
const SCRIPT_UNSAFE = new RegExp(`[<${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const BACKSLASH = String.fromCharCode(92);

/** JSON that is safe to place inside a <script> element (no "</script>", no raw line separators). */
function embedJson(value: unknown): string {
  const escape = (c: string) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, escape);
}

function page(title: string, data: ReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="tapedeck ${VERSION}">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main id="app"><noscript>This report needs JavaScript to render.</noscript></main>
<script type="application/json" id="tapedeck-data">${embedJson(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** Renders a single tape as a self-contained HTML timeline. */
export function renderTapeReport(tape: Tape): string {
  return page(`${tape.name ?? 'Tape'} · TapeDeck`, tapeReportData(tape));
}

/**
 * Renders a side-by-side diff of two tapes as a self-contained HTML page,
 * highlighting the first point of divergence.
 */
export function renderDiffReport(a: Tape, b: Tape, options: DiffOptions & { diff?: TapeDiff } = {}): string {
  const diff = options.diff ?? diffTapes(a, b, options);
  return page(`${a.name ?? 'Tape'} diff · TapeDeck`, diffReportData(a, b, diff));
}
