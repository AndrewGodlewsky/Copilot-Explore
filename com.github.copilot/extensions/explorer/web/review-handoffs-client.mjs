const journey = state => state.activeKey ?? state.document?.id;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const name = actor => actor?.displayName ?? 'Anonymous contributor';
const wasTaken = record => record.transitions.findLast(transition => transition.action !== 'complete')?.action === 'take';
const ordinary = node => node.parentId !== null && node.kind !== 'direction';

/** Explicit shared responsibility, with composing text owned only by this canvas. */
export class ReviewHandoffsClient {
  constructor({ $, el, button, fetch, state, active, canAct, begin, apply, copyText, eventText, selected }) {
    Object.assign(this, { $, el, button, fetch, state, active, canAct, begin, apply, copyText, eventText, selected });
    this.drafts = new Map(); this.selections = new Map(); this.epoch = 0; this.recordId = ''; this.page = 0; this.questionPage = 0;
    this.control('open').addEventListener('click', () => this.open(this.selected()));
    this.control('close').addEventListener('click', () => this.close());
    this.control('dialog').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.control('dialog').addEventListener('close', () => { if (!this.control('dialog').open) this.close(false); });
    for (const field of ['note', 'recipient']) this.control(field).addEventListener('input', () => { this.draft()[field] = this.control(field).value; });
    this.control('record').addEventListener('change', () => { this.recordId = this.control('record').value; this.update(); });
    this.control('filter').addEventListener('change', () => { this.page = 0; this.recordId = ''; this.update(); });
    this.control('scope').addEventListener('change', () => { this.questionPage = 0; this.update(); });
    this.control('search').addEventListener('input', () => { this.questionPage = 0; this.update(); });
    for (const [field, delta] of [['previous', -1], ['next', 1], ['questions-previous', -1], ['questions-next', 1]]) this.control(field).addEventListener('click', () => {
      if (field.startsWith('questions')) this.questionPage += delta; else { this.page += delta; this.recordId = ''; } this.update();
    });
    for (const action of ['create', 'take', 'reassign', 'complete', 'retry']) this.control(action).addEventListener('click', () => void this.post(action));
    this.control('copy').addEventListener('click', () => void this.copy());
  }
  control(id) { return this.$(`review-handoffs-${id}`); }
  draft() {
    if (!this.drafts.has(this.key)) this.drafts.set(this.key, { journey: journey(this.state()), note: '', recipient: '', unresolved: [], submission: null });
    return this.drafts.get(this.key);
  }
  chosenScope() { return this.control('scope').value === 'journey' ? { kind: 'journey' } : { kind: 'branch', nodeId: this.nodeId }; }
  open(nodeId) {
    const state = this.state(); if (!this.active() || !state.document) return;
    this.close(false); this.nodeId = nodeId ?? state.document.rootId; this.key = null;
    const previous = this.selections.get(JSON.stringify([journey(state), this.nodeId]));
    this.recordId = previous?.recordId ?? ''; this.page = previous?.page ?? 0; this.questionPage = previous?.questionPage ?? 0;
    this.control('scope').value = previous?.scope ?? (this.nodeId === state.document.rootId ? 'journey' : 'branch');
    this.control('search').value = previous?.search ?? ''; this.control('filter').value = previous?.filter ?? 'all'; this.control('status').textContent = '';
    this.control('dialog').showModal(); this.update(); this.control('note').focus();
  }
  close(focus = true) {
    this.epoch++; this.flight?.abort(); this.flight = null; this.release?.(); this.release = null;
    if (this.control('dialog').open) {
      this.selections.set(JSON.stringify([journey(this.state()), this.nodeId]), { recordId: this.recordId, page: this.page, questionPage: this.questionPage, scope: this.control('scope').value, search: this.control('search').value, filter: this.control('filter').value });
      this.control('dialog').close(); if (focus && this.active()) this.control('open').focus({ preventScroll: true });
    }
  }
  reconcile() {
    const state = this.state(), records = state.document?.reviewHandoffs?.records ?? [];
    for (const [key, draft] of this.drafts) {
      const post = draft.submission; if (!post || draft.journey !== journey(state)) continue;
      const record = records.find(record => record.id === post.id), transition = record?.transitions.find(row => row.id === post.transitionId);
      if (!transition || transition.action !== post.action || transition.note !== post.note || transition.recipient !== post.recipient || post.action === 'create' && (!same(record.scope, post.scope) || !same(record.unresolved.map(row => row.nodeId), post.unresolvedIds))) continue;
      const unchanged = draft.note === post.note && (!Object.hasOwn(post, 'recipient') || (draft.recipient.trim() || null) === post.recipient) && (post.action !== 'create' || same(draft.unresolved.map(row => row.id), post.unresolvedIds));
      if (unchanged) { draft.note = ''; if (Object.hasOwn(post, 'recipient')) draft.recipient = ''; if (post.action === 'create') draft.unresolved = []; }
      draft.submission = null;
      if (key === this.key && this.control('dialog').open) {
        this.control('status').textContent = unchanged ? 'Saved to the shared file. Commit and pull through Git to exchange this handoff.' : 'Previous action saved. Your newer composing text is retained.';
        if (unchanged && post.action === 'create') { this.recordId = record.id; this.control('filter').value = 'all'; this.page = Math.floor(records.indexOf(record) / 10); this.key = null; }
      }
    }
  }
  questions() {
    const doc = this.state().document, scope = this.chosenScope();
    if (scope.kind === 'journey') return doc.nodes.filter(ordinary);
    const ids = new Set([scope.nodeId]), children = new Map(doc.nodes.map(node => [node.id, []]));
    for (const node of doc.nodes) children.get(node.parentId)?.push(node.id);
    const queue = [scope.nodeId]; for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i]) ?? []) if (!ids.has(id)) { ids.add(id); queue.push(id); }
    return doc.nodes.filter(node => ids.has(node.id) && ordinary(node));
  }
  renderQuestions(draft) {
    const { el, button } = this, candidates = this.questions(), query = this.control('search').value.toLocaleLowerCase(), filtered = candidates.filter(node => node.question.toLocaleLowerCase().includes(query));
    this.questionPage = Math.max(0, Math.min(this.questionPage, Math.max(0, Math.ceil(filtered.length / 20) - 1)));
    const visible = filtered.slice(this.questionPage * 20, this.questionPage * 20 + 20), key = this.key, stamp = JSON.stringify([key, visible.map(node => [node.id, node.question])]);
    const current = control => this.active() && this.control('dialog').open && this.key === key && control.isConnected && !this.flight;
    if (stamp !== this.questionStamp) {
      this.questionStamp = stamp; this.control('questions').replaceChildren(...visible.map(node => {
        const checkbox = el('input', { type: 'checkbox', 'data-handoff-question': node.id });
        checkbox.addEventListener('change', () => {
          if (!current(checkbox)) return;
          if (checkbox.checked && !draft.unresolved.some(row => row.id === node.id)) {
            if (draft.unresolved.length >= 24) { checkbox.checked = false; this.control('status').textContent = 'Select at most 24 unresolved questions.'; return; }
            draft.unresolved.push({ id: node.id, label: node.question });
          } else if (!checkbox.checked) draft.unresolved = draft.unresolved.filter(row => row.id !== node.id);
          this.update();
        });
        return el('label', {}, [checkbox, ` ${node.question}`]);
      }));
    }
    for (const checkbox of this.control('questions').querySelectorAll('input')) { checkbox.checked = draft.unresolved.some(row => row.id === checkbox.dataset.handoffQuestion); checkbox.disabled = !!this.flight; }
    const available = new Set(candidates.map(node => node.id)), selectedStamp = JSON.stringify([key, draft.unresolved, [...available]]);
    if (selectedStamp !== this.selectedStamp) {
      this.selectedStamp = selectedStamp; this.control('selected').replaceChildren(el('p', {}, `${draft.unresolved.length}/24 questions selected`), ...draft.unresolved.map(row => {
        const remove = button('Remove selection', () => { if (current(remove)) { draft.unresolved = draft.unresolved.filter(chosen => chosen.id !== row.id); this.update(); } }, { 'data-remove-question': row.id });
        return el('div', {}, [el('p', {}, `${row.label}${available.has(row.id) ? '' : ' — removed or unavailable in this scope'}`), remove]);
      }));
    }
    for (const remove of this.control('selected').querySelectorAll('button')) remove.disabled = !!this.flight;
    this.control('questions-page').textContent = `${filtered.length} matching questions; page ${this.questionPage + 1} of ${Math.max(1, Math.ceil(filtered.length / 20))}. Selections persist across pages.`;
    this.control('questions-previous').disabled = !!this.flight || this.questionPage === 0; this.control('questions-next').disabled = !!this.flight || (this.questionPage + 1) * 20 >= filtered.length;
  }
  update() {
    this.reconcile(); const state = this.state(), { el } = this; this.control('open').hidden = !state.document;
    if (!this.control('dialog').open || !state.document) return;
    const records = state.document.reviewHandoffs?.records ?? [], statuses = state.reviewHandoffs ?? {}, filter = this.control('filter').value;
    const filtered = records.filter(record => filter === 'all' || ['requested', 'taken', 'complete'].includes(filter) && statuses[record.id]?.state === filter || ['changed', 'orphaned'].includes(filter) && statuses[record.id]?.context === filter);
    this.page = Math.max(0, Math.min(this.page, Math.max(0, Math.ceil(filtered.length / 10) - 1))); const visible = filtered.slice(this.page * 10, this.page * 10 + 10);
    if (this.recordId && !visible.some(record => record.id === this.recordId)) this.recordId = '';
    this.control('record').replaceChildren(el('option', { value: '' }, 'New review handoff'), ...visible.map(record => el('option', { value: record.id }, `${statuses[record.id]?.state ?? 'Unknown'} · ${record.source.label.slice(0, 100)}`))); this.control('record').value = this.recordId;
    this.control('page').textContent = `${filtered.length} handoffs; page ${this.page + 1} of ${Math.max(1, Math.ceil(filtered.length / 10))}`;
    this.control('previous').disabled = !!this.flight || this.page === 0; this.control('next').disabled = !!this.flight || (this.page + 1) * 10 >= filtered.length;
    for (const field of ['record', 'filter', 'scope', 'search']) this.control(field).disabled = !!this.flight;
    const record = records.find(record => record.id === this.recordId), status = record && statuses[record.id], scope = this.chosenScope(), node = state.document.nodes.find(node => node.id === this.nodeId);
    const key = JSON.stringify([journey(state), record ? 'record' : 'new', record?.id ?? [scope.kind, this.nodeId]]), changed = key !== this.key; this.key = key;
    const draft = this.draft(); for (const field of ['note', 'recipient']) if (changed || this.control(field).value !== draft[field]) this.control(field).value = draft[field];
    this.control('new').hidden = !!record; this.control('target').textContent = record?.source.label ?? (scope.kind === 'journey' ? state.document.topic : node?.question ?? 'Selected branch removed');
    this.control('context').textContent = record ? `${status?.state ?? 'Unknown'} handoff. Requested recipient: ${status?.recipient ?? 'Unassigned'} (unverified label; no notification). ${status?.owner ? `Taken by ${name(status.owner)}. ` : wasTaken(record) ? 'Taken by an anonymous contributor. ' : ''}${status?.context === 'orphaned' ? 'Branch removed; historical orphan handoff.' : status?.context === 'changed' ? 'Saved decision context changed; this summary is historical.' : 'Captured saved decision context matches.'} Completion does not approve decisions or resolve uncertainty.` : 'Request investigation of saved questions. A requested recipient has not accepted responsibility. No notification is sent.';
    const writable = state.storage?.scope === 'project' && !state.projectChange, enabled = writable && !state.pending && this.active() && this.canAct() && !this.flight;
    this.control('access').textContent = writable ? 'Shared locally in this Project file. Commit and pull through Git to exchange handoffs.' : 'Read-only handoffs. Open a current shared Project journey to change responsibility.';
    for (const action of ['create', 'take', 'reassign', 'complete']) {
      this.control(action).hidden = action === 'create' ? !!record : !record;
      this.control(action).disabled = !enabled || !!draft.submission || (action === 'create' ? scope.kind === 'branch' && !node : action === 'take' ? status?.state !== 'requested' : action === 'complete' ? status?.state === 'complete' : false);
    }
    this.control('retry').hidden = !draft.submission; this.control('retry').disabled = !enabled; this.control('copy').hidden = !record;
    this.control('copy').disabled = !this.active();
    if (!record) this.renderQuestions(draft);
    const stamp = JSON.stringify([record, journey(state)]);
    if (stamp !== this.historyStamp) {
      this.historyStamp = stamp;
      this.control('history').replaceChildren(...(record ? [el('h4', {}, 'Unresolved questions captured with this request'), ...record.unresolved.map(row => el('p', { class: 'review-handoff-text' }, `${row.question} (${row.nodeId})`)), ...record.transitions.map(transition => el('article', { class: 'review-handoff-event' }, [el('p', {}, `${transition.action} · ${this.eventText(transition.event)}${Object.hasOwn(transition, 'recipient') ? ` · Requested recipient: ${transition.recipient ?? 'Unassigned'}` : ''}`), el('p', { class: 'review-handoff-text' }, transition.note || 'No additional note.')]))] : []));
    }
  }
  async copy() {
    if (!this.active() || !this.control('dialog').open) return;
    const state = this.state(), record = state.document?.reviewHandoffs?.records.find(row => row.id === this.recordId); if (!record) return;
    const status = state.reviewHandoffs?.[record.id], epoch = this.epoch, identity = journey(state);
    const text = [`Review handoff: ${record.source.label}`, `Record: ${record.id}; scope: ${record.scope.kind}${record.scope.nodeId ? ` (${record.scope.nodeId})` : ''}`, `Status: ${status?.state ?? 'unknown'}; source context: ${status?.context ?? 'unknown'}`, `Requested recipient: ${status?.recipient ?? 'Unassigned'}; taken by: ${status?.owner ? name(status.owner) : wasTaken(record) ? 'Anonymous contributor' : 'Not recorded'}`, 'Names are unverified. Assignment is a request; no notification was sent. Completion does not approve decisions. Source fingerprint covers saved decision context, not research or discussion.', '', 'Captured unresolved questions:', ...record.unresolved.map(row => `${row.question} (${row.nodeId})`), '', ...record.transitions.flatMap(row => [`${row.action} — ${this.eventText(row.event)}${Object.hasOwn(row, 'recipient') ? `; requested recipient: ${row.recipient ?? 'Unassigned'}` : ''}`, row.note || 'No additional note.', ''])].join('\n');
    try { await this.copyText(text); if (epoch === this.epoch && identity === journey(this.state()) && this.control('dialog').open) this.control('status').textContent = 'Selected handoff copied. Other handoffs, answers and private drafts were omitted.'; }
    catch (error) { if (epoch === this.epoch && this.control('dialog').open) this.control('status').textContent = error.message; }
  }
  async post(action) {
    const state = this.state(); if (!this.active() || !this.canAct() || !this.control('dialog').open || this.flight || state.storage?.scope !== 'project' || state.pending || state.projectChange) return;
    const draft = this.draft();
    if (!draft.submission) {
      if (!['create', 'take', 'reassign', 'complete'].includes(action)) return;
      const recipient = draft.recipient.trim() || null;
      if (!draft.note.isWellFormed() || draft.note.length > 2000 || action === 'create' && !draft.note.trim() || ['create', 'reassign'].includes(action) && recipient !== null && (!recipient.isWellFormed() || recipient.length > 96 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(recipient))) { this.control('status').textContent = 'Enter a note up to 2,000 characters and an optional recipient up to 96 characters using valid Unicode. A new request needs a nonblank note; recipient names cannot contain control characters.'; return; }
      if (action === 'create') {
        const available = new Set(this.questions().map(node => node.id));
        if (draft.unresolved.length > 24 || draft.unresolved.some(row => !available.has(row.id))) { this.control('status').textContent = 'Remove unavailable selections and choose up to 24 unresolved questions.'; return; }
      }
      const uuid = () => this.control('dialog').ownerDocument.defaultView.crypto.randomUUID();
      draft.submission = { action, id: action === 'create' ? uuid() : this.recordId, transitionId: uuid(), note: draft.note, ...(['create', 'reassign'].includes(action) ? { recipient } : {}), ...(action === 'create' ? { scope: this.chosenScope(), unresolvedIds: draft.unresolved.map(row => row.id) } : {}) };
    }
    const { action: submittedAction, ...fields } = draft.submission, submission = draft.submission, identity = journey(state), epoch = ++this.epoch, abort = new AbortController(); this.flight = abort;
    const release = this.begin(); this.release = release;
    const current = () => this.active() && this.control('dialog').open && epoch === this.epoch && identity === journey(this.state());
    const timer = setTimeout(() => abort.abort(), 30000); this.control('status').textContent = 'Saving review handoff…'; this.update();
    try {
      const response = await this.fetch('api/action', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: `review-handoff-${submittedAction}`, revision: state.document.revision, journey: identity, ...fields }) });
      const result = await response.json(); if (!current()) return;
      if (!response.ok) { if (result.handoffSubmission === 'absent' && draft.submission === submission) draft.submission = null; throw Error(result.error); }
      if (journey(result) === identity && result.document?.revision >= this.state().document?.revision) this.apply(result);
    } catch (error) { if (current()) this.control('status').textContent = `${abort.signal.aborted ? 'Response timed out; the action may have saved.' : error.message} Your composing text is retained. ${draft.submission ? 'Refresh or retry the previous action before starting another submission.' : 'The server confirmed this action is absent. Correct your draft and try again.'}`; }
    finally { clearTimeout(timer); if (this.flight === abort) { this.flight = null; release(); if (this.release === release) this.release = null; } if (current()) this.update(); }
  }
}
