import { createHash, randomUUID } from 'node:crypto';
import { ProjectContext } from './project-context.mjs';
import { ADR_TEMPLATE_LIMIT, defaultAdrFormat, parseAdrTemplate, validateAdrFormat, validateAdrSelection, renderAdr, adrFilename } from './adr-format.mjs';
import { savedDigest } from './review-causes.mjs';

const TTL = 10 * 60 * 1000;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const obsolete = () => { throw Error('This ADR format review is obsolete. Read and review the selected template again.'); };
const invalid = () => { throw Error('Invalid ADR format request.'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Separate single-template contract. ProjectContext supplies physical file checks,
// not its excerpt selection, model permissions or any retained template text.
export class AdrFormatReview {
  constructor(readRoot) { this.reader = new ProjectContext(readRoot); this.current = null; this.order = null; this.generation = 0; this.timer = null; }
  clear() { clearTimeout(this.timer); this.timer = null; this.current = null; this.generation++; }
  async readTemplate(name) {
    validateAdrSelection({ directory: 'docs/decisions', naming: 'numbered', digits: 4, templatePath: name });
    let root, entry;
    try {
      root = await this.reader.root(); const expected = await this.reader.entry(root, name);
      if (expected.size > ADR_TEMPLATE_LIMIT) throw Error('Selected ADR template exceeds the 32 KiB limit.');
      entry = await this.reader.read(root, name, expected);
    } catch (error) {
      if (error.message === 'Selected ADR template exceeds the 32 KiB limit.') throw error;
      if (error.message === 'Project file exceeds the 64 KiB per-file limit.') throw Error('Selected ADR template exceeds the 32 KiB limit.');
      throw Error('Selected ADR template or project root is unavailable, linked or changed. Choose a regular file in the current project and review again.');
    }
    let text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.content); } catch { throw Error('ADR template must contain valid UTF-8 text.'); }
    const sha256 = hash(entry.content), layout = parseAdrTemplate(text);
    return { template: { kind: 'repository', path: name, sha256 }, layout, bytes: entry.size,
      capture: { root, entries: [{ stamp: entry.stamp, parents: entry.parents }], sources: [{ name, fingerprint: sha256 }] } };
  }
  fresh(capture) { return this.reader.fresh(capture); }
  valid(explorer, review) {
    return !explorer.closed && review.generation === this.generation && review.order === this.order && review.file === explorer.file && review.key === explorer.activeKey && review.journey === (explorer.activeKey ?? explorer.doc?.id) && Date.now() < review.expiresAt;
  }
  async request(explorer, input) {
    const fields = { status: 'action,journey', prepare: 'action,journey,clientId,sequence,selection', cancel: 'action,journey,clientId,sequence', save: 'action,journey,token,revision' };
    if (!input || !Object.hasOwn(fields, input.action) || !keys(input, fields[input.action]) || typeof input.journey !== 'string' || input.journey.length > 100 || explorer.closed || !explorer.doc || input.journey !== (explorer.activeKey ?? explorer.doc.id)) invalid();
    if (input.action === 'status') {
      const doc = await explorer.fresh(), format = doc.adrFormat ?? defaultAdrFormat();
      return { journey: input.journey, saved: !!doc.adrFormat, format: structuredClone(format), templateState: format.template.kind === 'repository' ? 'not-checked' : 'bundled' };
    }
    if (input.action === 'save') return explorer.withDocumentLock(async () => {
      if (!Number.isSafeInteger(input.revision) || input.revision !== explorer.doc.revision) throw Error('Saved journey revision changed. Refresh and review ADR formatting again.');
      const review = this.current;
      if (!review || typeof input.token !== 'string' || input.token !== review.token || !this.valid(explorer, review)) obsolete();
      this.current = null; clearTimeout(this.timer); this.timer = null;
      const current = await explorer.fresh();
      if (savedDigest(current) !== review.base || savedDigest(explorer.doc) !== review.base || !await this.fresh(review.capture) || !this.valid(explorer, review)) obsolete();
      const format = validateAdrFormat(review.format), next = { ...structuredClone(current), adrFormat: format };
      await explorer.commitCurrentLocked(current, next, 'Saved reviewed ADR formatting', async () => {
        if (!await this.fresh(review.capture)) throw Error('Selected ADR template or working root changed. Read and review again.');
        const latest = await explorer.readCurrent();
        if (!this.valid(explorer, review) || savedDigest(latest) !== review.base || savedDigest(explorer.doc) !== review.base) throw Error('Saved context changed during ADR format review. Refresh and review again.');
      });
      return { journey: input.journey, format: structuredClone(format), snapshot: explorer.uiSnapshot() };
    });
    if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1) invalid();
    if (this.order?.clientId === input.clientId && input.sequence <= this.order.sequence) obsolete();
    if (input.action === 'cancel' && this.order && input.clientId !== this.order.clientId) return { journey: input.journey, status: 'cancelled' };
    this.order = { clientId: input.clientId, sequence: input.sequence }; this.clear();
    if (input.action === 'cancel') return { journey: input.journey, status: 'cancelled' };
    const selection = validateAdrSelection(input.selection), review = { order: this.order, generation: this.generation, file: explorer.file, key: explorer.activeKey, journey: input.journey, expiresAt: Date.now() + TTL };
    const current = await explorer.fresh(); review.base = savedDigest(current);
    const source = selection.templatePath ? await this.readTemplate(selection.templatePath) : { ...defaultAdrFormat(), capture: null, bytes: 0 };
    const latest = await explorer.fresh();
    if (!this.valid(explorer, review) || savedDigest(latest) !== review.base || savedDigest(explorer.doc) !== review.base) obsolete();
    const format = validateAdrFormat({ version: 1, directory: selection.directory, naming: selection.naming, digits: selection.digits, template: source.template, layout: source.layout });
    review.format = format; review.capture = source.capture; review.token = randomUUID();
    const response = { journey: input.journey, clientId: input.clientId, sequence: input.sequence, token: review.token, expiresAt: review.expiresAt, format, templateBytes: source.bytes,
      sample: renderAdr(format, { title: 'Sample decision' }), pathExample: adrFilename(format, 'Sample decision', 1),
      notes: 'Sample formatting only; no decision generated. Template body, examples and metadata values are ignored. Directory availability and filename collisions are checked when writing, not here. The example number is not reserved. Saving preferences does not authorize future file reads.' };
    this.current = review; this.timer = setTimeout(() => this.clear(), TTL); this.timer.unref?.(); return response;
  }
}
