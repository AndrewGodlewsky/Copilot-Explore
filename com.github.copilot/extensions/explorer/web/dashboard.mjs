const number = value => value === null || value === undefined ? 'Unknown' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const stateNames = { unanswered: 'Unanswered', decided: 'Decided', tentative: 'Tentative', assumption: 'Assumption', 'needs-evidence': 'Need evidence', 'not-relevant': 'Not relevant', 'revisit-later': 'Revisit later' };
export function attachDashboard({ document: d, fetch, available = () => true }) {
  const $ = id => d.getElementById(id), dialog = $('dashboard-dialog');
  let epoch = 0, busy = false, abort = null;
  const element = (tag, text, attributes = {}) => { const node = d.createElement(tag); if (text !== undefined) node.textContent = text; for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node; };
  const paragraph = text => element('p', text);
  function table(title, headers, rows, numeric = false) {
    const table = element('table'); table.append(element('caption', title));
    const head = element('thead'), heading = element('tr'); for (const title of headers) heading.append(element('th', title, { scope: 'col' })); head.append(heading);
    const body = element('tbody');
    for (const row of rows) { const tr = element('tr'); row.forEach((value, index) => tr.append(element(index ? 'td' : 'th', typeof value === 'number' || value === null ? number(value) : value, index ? numeric ? { 'data-value': String(value) } : {} : { scope: 'row' }))); body.append(tr); }
    table.append(head, body); const scroll = element('div', undefined, { class: 'dashboard-table', tabindex: '0', role: 'region', 'aria-label': title }); scroll.append(table); return scroll;
  }
  function chart(title, headers, rows) {
    const host = element('div');
    if (!rows.length) { host.append(paragraph('No recorded data in this period.')); return host; }
    host.className = 'dashboard-chart';
    const ns = 'http://www.w3.org/2000/svg', svg = d.createElementNS(ns, 'svg'), height = rows.length * 32 + 8, width = 480, max = Math.max(1, ...rows.flatMap(row => row.slice(1).filter(Number.isFinite).map(Math.abs)));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${title}. Exact values in the following table. Negative values extend left of the center line.`);
    rows.forEach((row, index) => {
      const label = d.createElementNS(ns, 'text'); label.setAttribute('x', '2'); label.setAttribute('y', String(index * 32 + 17)); label.textContent = row[0]; svg.append(label);
      row.slice(1).forEach((value, series) => {
        const rect = d.createElementNS(ns, 'rect'), length = value === null ? 0 : Math.abs(value) / max * 120;
        rect.setAttribute('x', String(value < 0 ? 330 - length : 330)); rect.setAttribute('y', String(index * 32 + 3 + series * (24 / (row.length - 1)))); rect.setAttribute('width', String(length)); rect.setAttribute('height', String(Math.max(2, 21 / (row.length - 1)))); rect.setAttribute('class', `dashboard-series-${series % 4}`); rect.setAttribute('data-value', String(value));
        const titleNode = d.createElementNS(ns, 'title'); titleNode.textContent = `${row[0]} · ${headers[series + 1]}: ${number(value)}`; rect.append(titleNode); svg.append(rect);
      });
    });
    const legend = element('p', undefined, { class: 'dashboard-legend' });
    headers.slice(1).forEach((name, index) => { const label = element('span', name); label.prepend(element('i', undefined, { class: `dashboard-swatch-${index % 4}`, 'aria-hidden': 'true' })); legend.append(label); });
    host.append(legend, svg, table(title, headers, rows, true)); return host;
  }
  function section(id, title, children, opened = false) {
    const details = element('details', undefined, { 'data-section': id }), summary = element('summary', title, { 'data-focus': id }); details.open = opened; details.append(summary, ...children); return details;
  }
  function render(value) {
    const stock = value.stock, activity = value.activity, helpers = value.helpers, root = $('dashboard-results');
    const opened = new Set([...root.querySelectorAll('details[open]')].map(node => node.dataset.section)), focus = root.contains(d.activeElement) ? d.activeElement.dataset.focus : null;
    const summary = paragraph(`${stock.coverage === 'current-project-journey' ? 'Current project journey and its private records only. ' : 'Personal library and its private records. '}${number(stock.journeys)} included logical journeys · ${number(stock.questions)} saved questions · mean ${number(stock.mean)}, median ${number(stock.median)} questions per journey.`);
    const sizes = section('sizes', 'Current maps', [summary,
      paragraph(`Current stock is independent of date filters. ${stock.examined}/${stock.discovered} discovered files examined. ${stock.duplicates} identical extra copies, ${stock.ambiguous} divergent IDs excluded, ${stock.excluded} outside current scope, ${stock.unavailable} unavailable files. Identical mixed archive copies count active if any copy is active. Deleted files leave current stock.`),
      ...(stock.next || stock.truncated || stock.metadataUnavailable || stock.unavailable ? [paragraph(`Partial / provisional totals. Later copies may change deduplication. ${stock.next ? 'Continue scanning to include more files. ' : ''}${stock.truncated ? 'Discovery limit reached; additional files unscanned. ' : ''}${stock.metadataUnavailable ? 'Archive metadata unavailable; filtered stock excluded until repaired. ' : ''}`)] : []),
      paragraph(`Read interval ${stock.startedAt} to ${stock.aggregatedAt}. This is a sequential local scan, not an atomic snapshot. ${number(stock.allNodes)} all nodes include ideas and directions; saved question measures exclude both. Drafts are excluded.`),
      chart('Question count distribution', ['Questions per journey', 'Journeys'], stock.sizes.map(row => [row.label, row.value])),
      chart('Maximum structural depth', ['Depth (root = 0)', 'Journeys'], stock.depths.map(row => [row.label, row.value])),
      paragraph(`Mean branching: ${number(stock.branching)} children per non-leaf node (${stock.branchingParents} non-leaf nodes). Directions contribute to structural depth and branching.`),
      table('Exploration modes', ['Mode', 'Journeys'], Object.entries(stock.modes))], true);
    const answers = section('answers', 'Saved answer patterns', [
      paragraph(`${stock.answered}/${stock.questions} saved questions have nonblank answers; ${stock.resolved}/${stock.questions} are resolved. These measures overlap. Resolved means Decided or Not relevant without a review flag; it does not prove correctness.`),
      chart('Mutually exclusive saved answer states', ['State', 'Questions'], Object.entries(stock.states).map(([key, count]) => [stateNames[key], count]))]);
    const observed = section('activity', 'Observed activity and question growth', [
      paragraph(`All observed journeys, including subsequently archived/deleted files; independent of current stock scope. Inclusive UTC date filters apply here. Observation start: ${activity.startedAt ?? 'not yet recorded'}. Oldest retained: ${activity.retainedFrom ?? 'none'}. ${activity.pruned ?? 0} retention discards; ${activity.expired ?? 0} expired records excluded pending next append; read at ${activity.aggregatedAt ?? 'unknown'}; ${activity.failures} failed write attempts, ${activity.dropped} dropped queued observations, ${activity.pending} pending retries.${activity.unavailable ? ' Observation store unavailable; original data preserved.' : ''}`),
      paragraph('A visit is a newly owned Explorer canvas controller, not /explore, a chat session or active time. Reloads/repeated opens do not add visits. Changes count actual commits, including restores; net question delta excludes imports and library creation. History snapshots and old timestamps are never backfilled. Crashes between commit and observation can leave undetectable gaps. Local observations retain at most 2,000 records / 180 days; retained totals are not lifetime totals.'),
      ...(activity.days.length ? [paragraph('Last 30 observed UTC days in the selected period (no invented empty days).'), chart('Observed daily activity', ['UTC day', 'Visits', 'Committed changes', 'Net question delta'], activity.days.slice(-30).map(row => [row.day, row.visits, row.commits, row.delta]))] : [paragraph('No observed activity in this period. Existing maps are still included in current stock.')])]);
    const metricRows = Object.entries(helpers.metrics).map(([name, metric]) => [name === 'totalNanoAiu' ? 'Recorded nano AI units' : name.replace(/([A-Z])/g, ' $1'), metric.value, metric.known, metric.missing, metric.overflow ? 'Overflow: unknown' : 'Reported fields only']);
    const usage = section('helpers', 'Owned helper usage', [
      paragraph(`${helpers.receipts} receipts in the selected UTC period; ${helpers.retainedReceipts} retained receipts scanned. Earliest retained: ${helpers.retainedFrom ?? 'unknown'}. Read at ${helpers.scannedAt}. ${helpers.unavailable} unavailable files, ${helpers.malformed} malformed rows.${helpers.truncated ? ' Partial scan: entry, receipt or read budget reached.' : ''}`),
      paragraph('Only Explorer-owned allowlisted receipts. Missing values are unknown, never zero. Each metric has its own reported denominator; total tokens are not added to input/output/cache/reasoning components. Receipt timestamps use UTC; operation outcome dates use lifecycle updatedAt. Completed helpers do not mean recommendations were applied. Unfinished means active or unknown; no main-chat attribution, human time or money estimate. Retained receipts are protected from cleanup; older missing receipts cannot be detected.'),
      table('Reported metrics and coverage', ['Metric', 'Reported sum', 'Known receipts', 'Missing receipts', 'Coverage'], metricRows),
      paragraph(`Credit completeness: ${helpers.credits.complete} complete, ${helpers.credits.partial} partial, ${helpers.credits.unavailable} unavailable/unspecified. Nano AI units are raw reported accounting units, not dollars or a guessed credit conversion.`),
      chart('Owned helper outcomes', ['Operation', 'Completed', 'Failed', 'Cancelled', 'Unfinished'], Object.entries(helpers.outcomes).filter(([, counts]) => Object.values(counts).some(Boolean)).map(([name, counts]) => [name, ...Object.values(counts)])),
      table('Models (bounded; excess grouped)', ['Reported model', 'Receipts', 'Reported total tokens', 'Missing token totals', 'Recorded nano AI units', 'Missing nano units'], helpers.models.map(row => [row.model, row.receipts, row.totalTokens.value, row.totalTokens.missing, row.totalNanoAiu.value, row.totalNanoAiu.missing])),
      paragraph(`Last 30 receipt UTC days in the selected period. Daily summaries retain the newest 180 matching days; ${helpers.omittedDays} older days omitted from daily summaries (period totals still include them). Unknown bars have no length; exact values and missing-receipt counts remain below. Each chart has its own scale.`),
      chart('Reported total token trend', ['UTC day', 'Total tokens'], helpers.days.slice(-30).map(row => [row.day, row.totalTokens.value])),
      chart('Recorded nano AI unit trend', ['UTC day', 'Nano AI units'], helpers.days.slice(-30).map(row => [row.day, row.totalNanoAiu.value])),
      table('Daily metric coverage', ['UTC day', 'Receipts', 'Missing token totals', 'Missing nano units'], helpers.days.slice(-30).map(row => [row.day, row.receipts, row.totalTokens.missing, row.totalNanoAiu.missing]))]);
    root.replaceChildren(sizes, answers, observed, usage);
    for (const item of root.querySelectorAll('details')) if (opened.has(item.dataset.section)) item.open = true;
    if (focus) root.querySelector(`[data-focus="${focus}"]`)?.focus({ preventScroll: true });
    $('dashboard-next').hidden = !stock.next;
    $('dashboard-status').textContent = `${value.cached ? 'Cached' : 'Aggregated'} map/helper summaries; local observations refreshed.${value.stale ? ' Local changes observed: refresh to update.' : ''} Refresh rereads files; other canvases or external changes require Refresh. ${stock.next ? 'Provisional: more files available.' : ''}`;
  }
  function close(restore = true) { epoch++; abort?.abort(); dialog.close(); if (restore) $('dashboard-open').focus({ preventScroll: true }); }
  async function request(action) {
    if (busy || !available()) return;
    busy = true; const token = ++epoch; abort = new AbortController();
    for (const id of ['dashboard-refresh', 'dashboard-apply', 'dashboard-next']) $(id).disabled = true;
    $('dashboard-status').textContent = 'Reading bounded local aggregates…';
    const timer = setTimeout(() => abort?.abort(), 30000);
    try {
      const response = await fetch('api/dashboard', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, scope: $('dashboard-scope').value, from: $('dashboard-from').value, to: $('dashboard-to').value }) });
      const result = await response.json(); if (token !== epoch || !dialog.open || !available()) return;
      if (!response.ok) throw new Error(); render(result);
    } catch { if (token === epoch && dialog.open) $('dashboard-status').textContent = 'Dashboard unavailable. Check the UTC date range and refresh; saved content is preserved.'; }
    finally { clearTimeout(timer); busy = false; for (const id of ['dashboard-refresh', 'dashboard-apply', 'dashboard-next']) $(id).disabled = false; }
  }
  $('dashboard-open').addEventListener('click', () => { if (!available()) return; dialog.showModal(); $('dashboard-close').focus(); void request('cached'); });
  $('dashboard-close').addEventListener('click', () => close()); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  for (const [id, action] of [['dashboard-refresh', 'refresh'], ['dashboard-apply', 'cached'], ['dashboard-next', 'continue']]) $(id).addEventListener('click', () => void request(action));
  d.defaultView.addEventListener('pagehide', () => { if (dialog.open) close(false); });
}
