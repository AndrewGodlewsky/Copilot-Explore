import { createDocument, addQuestions } from '../../com.github.copilot/extensions/explorer/model.mjs';
import { prepareAdrDraft, parseAdrDraft, acceptAdrDraft } from '../../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { prepareAdrScope, captureAdrScope } from '../../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat } from '../../com.github.copilot/extensions/explorer/adr-format.mjs';

export function adrFileDocument() {
  const doc = createDocument('Storage λ');
  const [node] = addQuestions(doc, doc.rootId, [{ question: 'Which storage?', category: 'Design' }]);
  node.answer = 'Choose A because recovery is faster.'; node.answerState = 'decided';
  return doc;
}
export function saveAdrFixture(doc, scenario = null, format = defaultAdrFormat()) {
  doc.adrFormat = format;
  doc.adrScope = captureAdrScope(prepareAdrScope(doc, { focalId: doc.nodes[1].id, nodeIds: [doc.nodes[1].id], includeEvidence: false }, { scenario }));
  const prepared = prepareAdrDraft(doc, { scenario }), raw = { title: 'Storage λ', status: 'proposed', sections: { context: [], drivers: [], alternatives: [], outcome: [{ id: 'choice', text: doc.nodes[1].answer, certainty: 'user-decision', sources: [{ kind: 'node', id: doc.nodes[1].id }] }], consequences: [], confirmation: [], optionDetails: [] } };
  doc.adrDraft = acceptAdrDraft(parseAdrDraft(JSON.stringify(raw), prepared), { title: raw.title, statements: [] });
  return doc;
}
