import { randomUUID, createHash } from 'node:crypto';
import { projectDocumentAccess } from './storage-context.mjs';
import { readSharedDocument } from './shared-document.mjs';
import { createPortableReference, formatPortableReference, parsePortableReference, portableReferenceStatus } from './portable-reference.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = explorer => ({ journey: explorer.activeKey ?? explorer.doc?.id ?? null, revision: explorer.doc?.revision ?? null });
const same = (a, b) => a.journey === b.journey && a.revision === b.revision;
const fields = (input, expected) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== expected) throw Error('Invalid portable reference request.');
};
async function current(explorer, input) {
  if (explorer.closed || !explorer.projectRepository || !same(binding(explorer), input)) throw Error('The current journey changed or this canvas is closed. Inspect the reference again.');
  if (explorer.doc && (await explorer.readCurrent()).revision !== input.revision) throw Error('The current saved journey changed. Refresh before opening a reference.');
}
function unavailable(error) {
  if (error.code === 'ENOENT') return Error('The referenced file is missing or moved. Find it in the Project library and copy a new reference from its current location.');
  if (/linked/i.test(error.message)) return Error('The referenced file is linked or unavailable. Use an ordinary file inside the current checkout.');
  if (/changed|checkout|identity|repository/i.test(error.message)) return Error('The project checkout or referenced file changed or is unavailable. Inspect again in the intended checkout.');
  if (/unsupported/i.test(error.message)) return Error('The referenced file uses an unsupported shared format. Its contents were preserved.');
  return Error('The referenced file is malformed or unavailable. The current journey was kept.');
}

/** One explicit, read-only navigation selection, never a model action or public URL. */
export class PortableReferences {
  clear() { this.selection = null; }
  async request(explorer, input) {
    const shapes = { copy: 'action,journey,nodeId,revision', inspect: 'action,journey,revision,text', cancel: 'action,id,journey,revision' };
    fields(input, shapes[input?.action]);
    await current(explorer, input);
    if (input.action === 'cancel') { if (this.selection?.id === input.id) this.clear(); return { status: 'cancelled' }; }
    if (input.action === 'copy') {
      if (!explorer.projectStore) throw Error('Copy reference requires a saved shared Project journey.');
      const reference = createPortableReference(explorer.doc, explorer.projectStore.context.relativePath, input.nodeId);
      return { text: formatPortableReference(reference) };
    }
    this.clear(); const reference = parsePortableReference(input.text); let selected, access, source, read;
    try {
      selected = await explorer.projectRepository.selection(reference.path, false);
      access = await projectDocumentAccess(selected); source = await access.read(); read = readSharedDocument(source.bytes);
    } catch (error) { throw unavailable(error); }
    const document = read.document.journey, status = portableReferenceStatus(reference, document), node = document.nodes.find(node => node.id === reference.nodeId);
    await current(explorer, input);
    this.selection = { id: randomUUID(), view: binding(explorer), reference, status, selected, access, stamp: source.stamp, digest: hash(source.bytes), baseDigest: read.baseDigest };
    return { id: this.selection.id, path: reference.path, journeyId: document.id, nodeId: node.id, question: node.question, status };
  }
  async open(explorer, input) {
    fields(input, 'acknowledged,id,journey,revision');
    if (typeof input.acknowledged !== 'boolean') throw Error('Invalid portable reference acknowledgement.');
    await current(explorer, input);
    if (explorer.pending || explorer.preview) throw Error('Finish or cancel pending work and dismiss its question preview before opening a reference.');
    const selection = this.selection;
    const valid = () => {
      if (explorer.closed || this.selection !== selection || !selection || selection.id !== input.id || !same(selection.view, binding(explorer))) throw Error('Reference selection expired or the journey changed. Inspect again.');
    };
    valid();
    if (selection.status === 'changed' && !input.acknowledged) throw Error('Acknowledge that the saved target changed before opening its current content.');
    let store;
    try {
      const source = await selection.access.read();
      if (source.stamp !== selection.stamp || hash(source.bytes) !== selection.digest) throw Error('Referenced file changed.');
      store = await explorer.projectRepository.openSelected(selection.selected);
      if (store.fileStamp !== selection.stamp || store.baseDigest !== selection.baseDigest) throw Error('Referenced file changed.');
    } catch (error) { throw unavailable(error); }
    portableReferenceStatus(selection.reference, store.document);
    await explorer.attachProject(store, async () => {
      await current(explorer, input); valid();
      try {
        await store.context.assertCurrent();
        const finalSource = await selection.access.read();
        if (finalSource.stamp !== selection.stamp || hash(finalSource.bytes) !== selection.digest) throw Error('Referenced file changed.');
      } catch (error) { throw unavailable(error); }
      valid();
      if (explorer.pending || explorer.preview) throw Error('Finish pending work before opening a reference.');
    });
    this.clear();
    return { nodeId: selection.reference.nodeId };
  }
}
