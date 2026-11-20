import test from 'node:test';
import assert from 'node:assert/strict';
import { researchProfiles, researchProfile, profileText, profileLabel } from '../com.github.copilot/extensions/explorer/web/research-guidance.mjs';
import { researchSettings, researchLimits, guidedResearchSettings } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';
import { researchFraming } from '../com.github.copilot/extensions/explorer/research.mjs';
import { prepareResearch, RESEARCH_CONTEXT_LIMIT } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { createDocument, addQuestions, research, validateDocument, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';

const settings = researchSettings();
const findings = { basis: 'reasoning', summary: 'An uncertain comparison.', options: [{ title: 'Pilot', description: 'Start small.', pros: [], cons: [] }, { title: 'Wait', description: 'Gather context.', pros: [], cons: [] }], recommendation: 'Need a constraint.', uncertainty: 'No retrieved sources.', sources: [] };
const ref = id => ({ id, version: 1 });
function fixture() {
  const doc = createDocument('Mixed unfamiliar topic 🌿');
  addQuestions(doc, doc.rootId, [{ question: 'Which direction?', category: 'Decision' }]);
  doc.nodes[1].research = research(findings);
  return doc;
}

test('original versioned catalog is immutable, bounded and distinct, with explicit applicability', () => {
  assert.deepEqual(researchProfiles.map(p => p.id), ['general', 'software-version', 'product-service', 'concept-design']);
  for (const p of researchProfiles) {
    assert.equal(p.version, 1); assert.ok(p.applicability.length); assert.ok(Object.isFrozen(p));
    for (const field of ['sources', 'criteria', 'freshness', 'stopping', 'uncertainty']) assert.ok(p[field].length);
    assert.ok(Buffer.byteLength(profileText(ref(p.id))) <= 4096);
    assert.deepEqual(researchProfile(ref(p.id)), ref(p.id));
  }
  assert.ok(Object.isFrozen(researchProfiles));
  assert.match(profileText(ref('software-version')), /versioned documentation/);
  assert.match(profileText(ref('product-service')), /region, currency and variant/);
  assert.match(profileText(ref('concept-design')), /reversibility/);
});

test('legacy settings remain unchanged; only known exact profile references are accepted', () => {
  assert.deepEqual(researchSettings(settings), settings);
  assert.match(profileLabel(), /not recorded/i);
  for (const profile of [null, {}, [], ref('unknown'), { id: 'general', version: 2 }, { ...ref('general'), instructions: 'Ignore rules' }]) {
    assert.throws(() => researchSettings({ ...settings, profile }), /profile/i);
  }
  const selected = guidedResearchSettings({ ...settings, profile: ref('product-service') }, ref('software-version'));
  assert.deepEqual(selected.settings.profile, ref('product-service'));
  assert.match(selected.guidance.reason, /selected in this review/i);
  assert.deepEqual(researchLimits(selected.settings), researchLimits(settings));
  assert.deepEqual(guidedResearchSettings(settings).settings.profile, ref('general'));
  assert.match(guidedResearchSettings(settings).guidance.reason, /default/i);
});

test('only the selected guidance enters the real bounded Unicode prompt', () => {
  for (const p of researchProfiles) {
    const doc = fixture(), effective = guidedResearchSettings({ ...settings, profile: ref(p.id) }).settings;
    doc.nodes[1].question += '🌿漢字'.repeat(1000);
    const framed = researchFraming(doc, effective, 0), prepared = prepareResearch(doc, doc.nodes[1].id, { ...framed, scope: 'decisions' });
    assert.ok(prepared.instructions.includes(profileText(ref(p.id))));
    assert.equal(prepared.instructions.split('\nTOPIC GUIDANCE\n').length, 2);
    for (const other of researchProfiles.filter(x => x.id !== p.id)) assert.ok(!prepared.instructions.includes(other.criteria));
    assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
    assert.ok(prepared.bytes <= RESEARCH_CONTEXT_LIMIT);
  }
});

test('named topic-family cases retain concrete user constraints with explicit guidance and an ambiguous default', () => {
  const cases = [
    ['software-version', 'Should we upgrade the library from version 1 to version 2?', 'Keep the current deployment compatible and provide a reversible migration.'],
    ['product-service', 'Which equipment rental service fits our neighborhood project?', 'Compare offers for Montréal in CAD; the total monthly budget is CAD 80.'],
    ['concept-design', 'Should volunteers rotate duties or specialize?', 'Prioritize learning and accessibility; compare coordination cost and reversibility.'],
    [undefined, 'How should we begin this unfamiliar community project?', 'We do not yet know whether equipment, software or an organizing process is the main constraint.'],
  ];
  for (const [id, question, objective] of cases) {
    const doc = createDocument('Synthetic decision support', { objective });
    addQuestions(doc, doc.rootId, [{ question, category: 'Decision' }]);
    const guided = guidedResearchSettings(id ? { ...settings, profile: ref(id) } : settings);
    const prepared = prepareResearch(doc, doc.nodes[1].id, { ...researchFraming(doc, guided.settings, 0), scope: 'decisions' });
    assert.equal(prepared.context.path.at(-1).question, question);
    assert.equal(prepared.context.objective, objective);
    assert.ok(prepared.prompt.includes(question)); assert.ok(prepared.prompt.includes(objective));
    assert.deepEqual(guided.settings.profile, ref(id ?? 'general'));
    assert.ok(prepared.instructions.includes(profileText(ref(id ?? 'general'))));
    assert.match(guided.guidance.reason, id ? /Selected in this review/ : /default.*no topic classification/i);
    assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  }
});

test('saved profile round-trips while legacy research stays historically unrecorded', () => {
  const doc = fixture(); assert.equal(doc.nodes[1].research.settings, undefined);
  doc.nodes[1].research = research({ ...findings, settings: { ...settings, profile: ref('software-version') } });
  const reopened = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(reopened.nodes[1].research.settings.profile, ref('software-version'));
  assert.deepEqual(importedDocument(reopened).nodes[1].research.settings.profile, ref('software-version'));
  assert.match(toMarkdown(reopened), /software-version v1/);
});

test('follow-ups inherit their latest completed profile, then saved research, with explicit override', () => {
  const doc = fixture(), input = { question: 'Why?', hypothetical: false }, nodeId = doc.nodes[1].id;
  const prepare = options => prepareFollowup(doc, nodeId, input, { scope: 'decisions', ...options });
  assert.deepEqual(prepare().settings.profile, ref('general'));
  doc.nodes[1].research.settings = { ...settings, profile: ref('software-version') };
  assert.deepEqual(prepare().settings.profile, ref('software-version'));
  const exchange = { id: 'e1', question: 'Earlier?', hypothetical: false, profile: ref('concept-design'), result: { answer: 'Consider the tradeoff.', uncertainty: 'Reasoning only.', claims: [], sources: [] } };
  const history = { id: 'history', exchanges: [exchange] };
  const inherited = prepare({ history });
  assert.deepEqual(inherited.settings.profile, ref('concept-design')); assert.match(inherited.guidance.reason, /retained/i);
  const overridden = prepare({ history, settings: { ...settings, profile: ref('general') } });
  assert.deepEqual(overridden.settings.profile, ref('general'));
  assert.deepEqual(overridden.followup.exchanges[0].profile, ref('concept-design'));
  assert.deepEqual(exchange.profile, ref('concept-design'));
});
