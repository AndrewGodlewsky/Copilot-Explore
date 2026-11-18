import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { measure, domFixture } from './perf-baseline.mjs';
import { fixtureSpecs, makeFixture } from './perf-fixtures.mjs';
import { validateDocument, isQuestion, DecisionImpact, impactPath, criticalPaths } from '../com.github.copilot/extensions/explorer/model.mjs';
import { NextQuestion } from '../com.github.copilot/extensions/explorer/web/next-question.mjs';

const root = resolve(import.meta.dirname, '..'), output = join(root, '.perf-baseline');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const report = { version, commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model }, warmups: 1, samples: 2, cases: [] };
for (const spec of fixtureSpecs.filter(spec => spec.name.startsWith('near'))) {
  const { document: doc } = makeFixture(spec), questions = doc.nodes.filter(isQuestion);
  if (!spec.nearBytes) {
    doc.dependencies = [];
    for (let distance = 1; doc.dependencies.length < 10000 && distance < 4; distance++) for (let i = distance; i < questions.length && doc.dependencies.length < 10000; i++) doc.dependencies.push({ dependentId: questions[i].id, prerequisiteId: questions[i - distance].id });
  }
  validateDocument(doc);
  const source = questions[0].id, target = questions.at(-1).id, bytes = Buffer.byteLength(JSON.stringify(doc, null, 2)), index = new DecisionImpact(doc), result = index.analyze(source);
  const phases = {}, fixture = { name: spec.name, nodes: doc.nodes.length, dependencies: doc.dependencies?.length ?? 0, bytes, fingerprint: createHash('sha256').update(JSON.stringify(doc)).digest('hex') };
  await measure(phases, 'index', 'Build saved-map adjacency snapshot', () => { new DecisionImpact(doc); return { nodes: doc.nodes.length, edges: doc.nodes.length - 1 + (doc.dependencies?.length ?? 0) }; });
  await measure(phases, 'analysis', 'Inspect one influential saved question', () => index.analyze(source), { report: result => ({ affected: result.counts.total, visitedEdges: result.visitedEdges, band: result.band }) });
  await measure(phases, 'path', 'Materialize one requested explanation path', () => ({ steps: impactPath(result, target, 'combined').length }));
  await measure(phases, 'nextQuestion', 'Rank all saved eligible questions and explain the winner with a cold impact cache', () => {
    const result = new NextQuestion().suggest(doc); assert.equal(result.counts.questions, questions.length);
    return { questions: result.counts.questions, eligible: result.counts.eligible, candidate: result.candidate?.id ?? null, band: result.candidate?.impact.band ?? null, affected: result.candidate?.impact.counts.total ?? 0 };
  });
  await measure(phases, 'allBands', 'Calculate exact display bands for every question with a cold cache', (_i, index) => {
    const counts = { low: 0, medium: 0, high: 0 };
    for (const question of questions) counts[index.bandFor(question.id)]++;
    assert.equal(Object.values(counts).reduce((a,b) => a+b, 0), questions.length);
    return { questions: questions.length, ...counts };
  }, { setup: () => new DecisionImpact(doc) });
  await measure(phases, 'criticalSelection', 'Select all critical decisions and recorded dependency context with a cold band cache', (_i, index) => {
    const result = criticalPaths(doc, index); assert.ok(result.ids.size <= doc.nodes.length); assert.ok(result.visitedLinks <= 2 * (doc.dependencies?.length ?? 0));
    return { highlighted: result.highlights.size, included: result.ids.size, visitedLinks: result.visitedLinks };
  }, { setup: () => new DecisionImpact(doc) });
  await measure(phases, 'criticalView', 'Enter critical paths in the shipped UI (jsdom)', (_i, f) => {
    f.window.document.getElementById('critical-paths').click(); assert.equal(f.window.document.getElementById('critical-return').hidden, false);
    return { renderedCards: f.window.document.querySelectorAll('#nodes [data-critical]').length, renderedEdges: f.window.document.querySelectorAll('#edges path').length };
  }, { setup: () => domFixture(doc), dispose: f => f.close() });
  await measure(phases, 'displayMode', 'Enable impact connection display in the shipped UI (jsdom)', (_i, f) => {
    const select = f.window.document.getElementById('impact-display'); select.value = 'impact'; select.dispatchEvent(new f.window.Event('change'));
    const paths = f.window.document.querySelectorAll('#edges [data-impact]'); assert.ok(paths.length > 0);
    return { renderedEdges: paths.length };
  }, { setup: () => domFixture(doc), dispose: f => f.close() });
  await measure(phases, 'openPanel', 'Open impact inspection in the shipped UI (jsdom)', (_i, f) => {
    const panel = f.window.document.getElementById('decision-impact'); panel.open = true; panel.dispatchEvent(new f.window.Event('toggle'));
    const options = f.window.document.getElementById('impact-affected').options.length, pathRows = f.window.document.getElementById('impact-path').children.length;
    assert.ok(options <= 50 && pathRows <= 30); assert.match(f.window.document.getElementById('impact-summary').textContent, /affected questions/);
    return { options, pathRows };
  }, { setup: async () => { const f = await domFixture(doc); f.window.__perf.select(source); return f; }, dispose: f => f.close() });
  report.cases.push({ fixture, phases });
}
await mkdir(output, { recursive: true }); await writeFile(join(output, 'impact.json'), JSON.stringify(report, null, 2) + '\n');
const lines = [`# Explorer ${version} decision impact measurements`, '', `Commit: ${report.commit}; dirty: ${report.dirty}.`, `Node ${report.environment.node}; ${report.environment.platform} ${report.environment.release}; ${report.environment.cpu}.`, '', 'One warmup, two samples; median [min, max] milliseconds. Synthetic maps only; no provider or native browser.', '', '| Fixture | Nodes | Dependencies | Phase | Median [min, max] ms | Work |', '| --- | ---: | ---: | --- | ---: | --- |'];
for (const { fixture, phases } of report.cases) for (const [name, phase] of Object.entries(phases)) lines.push(`| ${fixture.name} | ${fixture.nodes} | ${fixture.dependencies} | ${name} | ${phase.status === 'ok' ? `${phase.medianMs.toFixed(2)} [${phase.minMs.toFixed(2)}, ${phase.maxMs.toFixed(2)}]` : 'FAILED'} | ${JSON.stringify(phase.operations ?? phase.error)} |`);
lines.push('', 'Setup and teardown excluded. The open-panel phase includes index, analysis and paged DOM updates; initial workspace construction is outside this phase. allBands starts from a new index without cached bands; index construction is excluded. displayMode includes saved-content key/index and visible connection rendering. These timings do not establish native rendering or interaction latency. Derived paths use at most three predecessor maps; only one requested path is materialized.');
await writeFile(join(output, 'impact.md'), lines.join('\n') + '\n'); console.log(lines.join('\n'));
if (report.cases.some(item => Object.values(item.phases).some(phase => phase.status !== 'ok'))) process.exitCode = 1;
