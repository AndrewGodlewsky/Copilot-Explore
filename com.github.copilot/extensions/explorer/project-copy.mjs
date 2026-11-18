import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { prepareSharedMigration, readSharedDocument } from './shared-document.mjs';
import { FORMAT } from './model.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const collision = () => Error('The destination contains a different or changed copy. Open it from the Project library to reconcile, or explicitly request an additional copy. Nothing was overwritten.');

/** Caller serializes requests and holds the personal document lock for preview/confirm. */
export class ProjectCopy {
  constructor(repository, readSource) { this.repository = repository; this.readSource = readSource; this.selection = null; }
  async preview({ folder, includeResearch, newCopy }) {
    this.selection = null;
    if (typeof folder !== 'string' || typeof includeResearch !== 'boolean' || typeof newCopy !== 'boolean') throw Error('Invalid project copy selection.');
    const source = prepareSharedMigration(await this.readSource()), document = structuredClone(source.document);
    const destination = process.platform === 'win32' ? folder.toLowerCase() : folder;
    const id = newCopy ? randomUUID() : `copy-${hash(JSON.stringify([source.contentDigest, includeResearch, destination])).slice(0, 40)}`;
    document.journey.id = id;
    document.journey.copyOrigin = { kind: 'personal-copy', sourceId: source.document.journey.id, sourceDigest: source.contentDigest };
    if (!includeResearch) for (const node of document.journey.nodes) node.research = null;
    const prepared = prepareSharedMigration(JSON.stringify({ format: FORMAT, version: 1, revision: 0, ...document.journey }));
    const selected = await this.repository.selection(`${folder}/${id}.explore.json`, false);
    // Remember all existing ancestors without creating folders during review.
    const ancestors = []; let parent = selected.checkoutDirectory;
    for (const part of selected.relativePath.split('/').slice(0, -1)) {
      parent = join(parent, part);
      try { ancestors.push(await directoryState(parent)); } catch (error) { if (error.code !== 'ENOENT') throw error; break; }
    }
    const revalidate = selected.revalidate;
    selected.revalidate = async () => {
      await revalidate();
      for (const captured of ancestors) if (JSON.stringify(await directoryState(captured.path)) !== JSON.stringify(captured)) throw Error('Project destination identity changed. Preview again.');
    };
    const selection = { id: randomUUID(), selected, prepared, sourceDigest: source.sourceDigest, expires: Date.now() + 15 * 60 * 1000, confirmed: false };
    const existing = await this.existing(selection);
    selection.reviewedContent = existing?.content ?? prepared.content; selection.reviewedDigest = hash(selection.reviewedContent); this.selection = selection;
    return { id: selection.id, path: selected.relativePath, content: selection.reviewedContent, existing: !!existing,
      researchIncluded: includeResearch, researchCount: source.document.journey.nodes.filter(node => node.research).length };
  }
  get(id) {
    if (!this.selection || this.selection.id !== id || Date.now() > this.selection.expires) throw Error('Project copy preview expired. Review the content again.');
    return this.selection;
  }
  async existing(selection) {
    await selection.selected.revalidate();
    let access;
    try { access = await projectDocumentAccess(selection.selected); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let bytes;
    try { bytes = (await access.read()).bytes; } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const read = readSharedDocument(bytes);
    if (read.contentDigest !== selection.prepared.contentDigest) throw collision();
    if (selection.reviewedDigest && read.baseDigest !== selection.reviewedDigest) throw Error('Destination file bytes changed after preview. Review the existing copy again.');
    return read;
  }
  async confirm(id) {
    const selection = this.get(id);
    const checkSource = async () => { if (prepareSharedMigration(await this.readSource()).sourceDigest !== selection.sourceDigest) throw Error('Personal source changed after preview. Review a fresh copy; existing files and drafts are preserved.'); };
    await checkSource();
    let existing = await this.existing(selection);
    if (!existing) {
      const document = { format: FORMAT, version: 1, revision: 0, ...selection.prepared.document.journey };
      try { await this.repository.createSelected(document, selection.selected, { beforeWrite: checkSource }); }
      catch (error) { if (!await this.existing(selection)) throw error; } // A lost response or concurrent identical creation is safe to recognize.
      existing = await this.existing(selection);
      if (!existing) throw Error('Project copy could not be verified. Keep this preview and retry.');
    }
    await checkSource(); selection.confirmed = true;
    return { id, path: selection.selected.relativePath, saved: true };
  }
  async open(id) {
    const selection = this.get(id);
    if (!selection.confirmed || !await this.existing(selection)) throw Error('Confirm and verify the project copy before continuing.');
    const store = await this.repository.openSelected(selection.selected);
    if (readSharedDocument(JSON.stringify(store.shared)).contentDigest !== selection.prepared.contentDigest) throw collision();
    return store;
  }
}
