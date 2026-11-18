/** A literal historical view. Its owner handles request identity and navigation guards. */
export class AdrSourcesClient {
  constructor({ $, active, openReference }) {
    Object.assign(this, { $, active, openReference }); this.locked = false;
    this.control('node').addEventListener('change', () => this.renderNode());
    this.control('inspect').addEventListener('click', () => {
      const ref = this.reference();
      if (this.active() && !this.locked && ref) this.openReference(JSON.stringify(ref, null, 2));
    });
    this.clear();
  }
  control(id) { return this.$(`adr-sources-${id}`); }
  reference() { return this.value?.capture?.references.find(ref => ref.nodeId === this.control('node').value); }
  update(locked = this.locked) { this.locked = locked; this.control('node').disabled = locked || !this.value?.capture; this.control('inspect').disabled = locked || !this.reference(); }
  clear() {
    this.value = null; this.control('panel').hidden = true; this.control('node').replaceChildren();
    for (const id of ['status', 'meta', 'guidance', 'record', 'evidence', 'mappings']) this.control(id).textContent = '';
    this.update();
  }
  render(value) {
    this.clear(); this.value = value; this.control('panel').hidden = false;
    this.control('status').textContent = `${value.sourceStatus.status}: ${value.sourceStatus.message}`;
    const c = value.capture; if (!c) { this.update(); return; }
    this.control('meta').textContent = `${value.title}\nCaptured ${c.capturedAt}. Capture fingerprint: ${c.digest}.\n${c.journey.path ? `Journey: ${c.journey.path}\nADR from Git root: ${c.adrPath}` : 'Personal journey: portable location unavailable.'}\nCommitted source: ${c.journey.commit ?? 'unavailable; no committed revision claimed'}.`;
    this.control('guidance').textContent = `Topic: ${c.guidance.topic}\nObjective: ${c.guidance.objective || 'Unspecified'}\nSuccess criteria: ${c.guidance.successCriteria || 'Unspecified'}\nMode: ${c.guidance.mode}\n${c.guidance.pins.map(pin => `Constraint: ${pin.text}`).join('\n')}`;
    this.control('mappings').textContent = c.statements.map(s => `${s.section} / ${s.id}: ${s.sources.length ? s.sources.map(ref => ref.kind === 'node' ? `node ${ref.id}` : ref.kind === 'guidance' ? `guidance ${ref.field}` : `evidence ${ref.nodeId}/${ref.sourceId}`).join('; ') : 'No source recorded'}`).join('\n');
    for (const node of c.nodes) {
      const option = this.control('node').ownerDocument.createElement('option'); option.value = node.record.id; option.textContent = node.record.question; this.control('node').append(option);
    }
    this.renderNode();
  }
  renderNode() {
    const c = this.value?.capture, node = c?.nodes.find(n => n.record.id === this.control('node').value);
    if (!node) { this.update(); return; }
    const r = node.record, status = this.value.sourceStatus.nodes.find(n => n.id === r.id)?.status ?? 'unavailable';
    this.control('record').textContent = `Current source: ${status}. This text is the historical capture.\n${r.question}\nCaptured state: ${r.answerState ?? 'direction (user supplied)'}${r.review ? '; needs review' : ''}\nCaptured answer: ${r.answer || (r.kind === 'direction' ? 'Not an answer; user direction' : 'Unanswered')}\nFingerprint: ${node.fingerprint}`;
    const evidence = c.evidence.find(item => item.nodeId === r.id), lines = [];
    if (!c.includeEvidence) lines.push('Research evidence was omitted from this capture.');
    else {
      lines.push('Recorded AI interpretation, not independently verified evidence. Original provenance and limitations follow.');
      if (evidence) {
        lines.push(`Basis: ${evidence.basis}`);
        for (const source of evidence.sources) lines.push(`${source.id ?? 'Legacy source'}: ${source.title}\n${source.url}\nCaptured provenance: ${source.provenance ?? 'unknown'}; recorded retrieval: ${source.retrievedAt ?? 'unknown'}`);
        for (const claim of evidence.claims ?? []) lines.push(`${claim.id} (${claim.basis}): ${claim.text}\nLimitations: ${claim.limitations || 'None recorded; reliability is not established'}\n${claim.evidence.map(e => `${e.sourceId}: ${e.paraphrase}`).join('\n')}`);
        if (!evidence.claims && evidence.sources.length) lines.push('Legacy sources have no structured claim support or recorded limitations.');
      }
    }
    this.control('evidence').textContent = lines.join('\n\n'); this.update();
  }
}
