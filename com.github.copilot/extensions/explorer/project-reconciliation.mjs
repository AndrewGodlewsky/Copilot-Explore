import { randomUUID } from 'node:crypto';
import { directoryState, projectStorageContext } from './storage-context.mjs';
import { readSharedDocument } from './shared-document.mjs';
import { ProjectJourney } from './project-journey.mjs';
import { FORMAT } from './model.mjs';

export class ProjectReconciliation {
  constructor(repository, store) { this.repository = repository; this.original = store; this.displayed = structuredClone(store.document); this.selection = null; }
  preserve() { return this.original.preserveDisplayed(this.displayed); }
  async preview() {
    this.selection = null;
    const selected = await this.repository.selection(this.original.context.relativePath, false);
    const checkout = await directoryState(selected.checkoutDirectory);
    if (checkout.path !== this.original.context.checkoutDirectory || checkout.identity !== this.original.context.checkoutIdentity) throw Error('The physical checkout changed. Preserve the displayed base and open the intended journey from the Project library.');
    const context = await projectStorageContext({ ...selected, journeyId: this.displayed.id });
    const source = await context.read(), incoming = { ...readSharedDocument(source.bytes), stamp: source.stamp };
    for (const key of ['id', 'rootId', 'createdAt']) if (incoming.document.journey[key] !== this.displayed[key]) throw Error('Incoming journey identity is different. Open it separately; original drafts are preserved.');
    const store = new ProjectJourney(Object.freeze({ ...context, relativePath: selected.relativePath }));
    const selection = { id: randomUUID(), store, incoming, expires: Date.now() + 15 * 60 * 1000 }; this.selection = selection;
    return { id: selection.id, changed: incoming.baseDigest !== this.original.baseDigest, path: selected.relativePath, content: incoming.content,
      document: { format: FORMAT, version: 1, revision: 0, ...incoming.document.journey } };
  }
  async reload(id, options) {
    const selected = this.selection;
    if (!selected || selected.id !== id || Date.now() > selected.expires) throw Error('Reconciliation preview expired. Refresh and review again.');
    await this.preserve();
    return selected.store.adoptIncoming(selected.incoming.baseDigest, this.displayed, { ...options, expectedStamp: selected.incoming.stamp });
  }
}
