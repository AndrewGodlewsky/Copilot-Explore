const journey = state => state.activeKey ?? state.document?.id;

/** Saved discussion and unposted canvas text have deliberately separate owners. */
export class CommentsClient {
  constructor({ $, el, button, fetch, state, active, canAct, begin, apply, append, eventText, selected }) {
    Object.assign(this, { $, el, button, fetch, state, active, canAct, begin, apply, append, eventText, selected });
    this.drafts = new Map(); this.selections = new Map(); this.epoch = 0; this.page = 0; this.threadId = ''; this.key = null;
    $('comments-open').addEventListener('click', () => this.open(this.selected()));
    $('comments-close').addEventListener('click', () => this.close());
    $('comments-dialog').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    $('comments-dialog').addEventListener('close', () => { if (!$('comments-dialog').open) this.close(false); });
    for (const field of ['text', 'suggestion']) $(`comments-${field}`).addEventListener('input', () => { this.draft()[field] = $(`comments-${field}`).value; });
    $('comments-thread').addEventListener('change', () => { this.threadId = $('comments-thread').value; this.update(); });
    $('comments-filter').addEventListener('change', () => { this.page = 0; this.threadId = ''; this.update(); });
    for (const [name, delta] of [['previous', -1], ['next', 1]]) $(`comments-${name}`).addEventListener('click', () => { this.page += delta; this.threadId = ''; this.update(); });
    $('comments-post').addEventListener('click', () => void this.post(this.threadId ? 'reply' : 'create'));
    for (const action of ['resolve', 'reopen']) $(`comments-${action}`).addEventListener('click', () => void this.post(action));
  }
  draft() {
    if (!this.drafts.has(this.key)) this.drafts.set(this.key, { journey: journey(this.state()), text: '', suggestion: '', submission: null });
    return this.drafts.get(this.key);
  }
  open(nodeId) {
    if (!this.active() || !this.state().document) return;
    this.close(false); this.nodeId = nodeId ?? this.state().document.rootId; this.threadId = ''; this.page = 0; this.key = null;
    const previous = this.selections.get(JSON.stringify([journey(this.state()), this.nodeId]));
    this.threadId = previous?.threadId ?? ''; this.page = previous?.page ?? 0;
    this.$('comments-filter').value = previous?.filter ?? 'all'; this.$('comments-status').textContent = '';
    this.$('comments-dialog').showModal(); this.update(); this.$('comments-text').focus();
  }
  close(focus = true) {
    this.epoch++; this.flight?.abort(); this.flight = null; this.release?.(); this.release = null;
    const dialog = this.$('comments-dialog');
    if (dialog.open) {
      this.selections.set(JSON.stringify([journey(this.state()), this.nodeId]), { threadId: this.threadId, page: this.page, filter: this.$('comments-filter').value });
      dialog.close(); if (focus && this.active()) this.$('comments-open').focus({ preventScroll: true });
    }
  }
  reconcile() {
    const state = this.state(), threads = state.document?.comments?.threads ?? [];
    for (const [key, draft] of this.drafts) {
      const post = draft.submission;
      if (!post || draft.journey !== journey(state)) continue;
      const thread = threads.find(thread => thread.id === post.threadId), message = thread?.messages.find(message => message.id === post.messageId);
      if (!message || message.text !== post.text || message.suggestion !== post.suggestion || post.nodeId && post.nodeId !== thread.nodeId) continue;
      const unchanged = draft.text === post.text && (draft.suggestion || undefined) === post.suggestion;
      if (unchanged) { draft.text = ''; draft.suggestion = ''; }
      draft.submission = null;
      if (this.$('comments-dialog').open && key === this.key) {
        this.$('comments-status').textContent = unchanged ? 'Posted to the shared file. Commit and share through Git for others to receive it.' : 'Previous post saved. Your newer composing text is retained.';
        if (unchanged && post.nodeId) { this.threadId = thread.id; this.$('comments-filter').value = 'all'; this.page = Math.floor(threads.indexOf(thread) / 10); this.key = null; }
      }
    }
  }
  update() {
    this.reconcile();
    const { $, el, button } = this, state = this.state(); $('comments-open').hidden = !state.document;
    if (!$('comments-dialog').open || !state.document) return;
    const threads = state.document.comments?.threads ?? [], statuses = state.comments ?? {}, filter = $('comments-filter').value;
    const filtered = threads.filter(thread => filter === 'all' || filter === 'node' && thread.nodeId === this.nodeId || ['open', 'resolved'].includes(filter) && statuses[thread.id]?.state === filter || ['changed', 'orphaned'].includes(filter) && statuses[thread.id]?.context === filter);
    this.page = Math.max(0, Math.min(this.page, Math.max(0, Math.ceil(filtered.length / 10) - 1)));
    const visible = filtered.slice(this.page * 10, this.page * 10 + 10);
    if (this.threadId && !visible.some(thread => thread.id === this.threadId)) this.threadId = '';
    $('comments-thread').replaceChildren(el('option', { value: '' }, 'New discussion on selected node'), ...visible.map(thread => el('option', { value: thread.id }, `${statuses[thread.id]?.state ?? 'Unknown'} · ${thread.source.question.slice(0, 100)}`)));
    $('comments-thread').value = this.threadId;
    $('comments-page').textContent = `${filtered.length} discussions · page ${this.page + 1} of ${Math.max(1, Math.ceil(filtered.length / 10))}`;
    $('comments-previous').disabled = !!this.flight || this.page === 0; $('comments-next').disabled = !!this.flight || (this.page + 1) * 10 >= filtered.length;
    $('comments-thread').disabled = $('comments-filter').disabled = !!this.flight;
    const thread = threads.find(thread => thread.id === this.threadId), node = state.document.nodes.find(node => node.id === (thread?.nodeId ?? this.nodeId)), status = thread && statuses[thread.id];
    const key = JSON.stringify([journey(state), thread ? 'thread' : 'new', thread?.id ?? this.nodeId]), changed = key !== this.key; this.key = key;
    const draft = this.draft();
    for (const field of ['text', 'suggestion']) if (changed || $(`comments-${field}`).value !== draft[field]) $(`comments-${field}`).value = draft[field];
    $('comments-target').textContent = thread?.source.question ?? node?.question ?? 'The selected node was removed.';
    $('comments-context').textContent = thread ? `${status?.state === 'resolved' ? 'Resolved discussion' : 'Open discussion'}. ${status?.context === 'orphaned' ? 'Source node removed; historical orphan discussion.' : status?.context === 'changed' ? 'Saved question or answer changed since this discussion began.' : 'Captured question and answer match the saved source.'}${status?.resolution === 'historical' ? ' Historical resolution does not cover the current messages; review again.' : ''} Status recorded by: ${this.eventText(thread.status.event)}. Resolution is not decision approval.` : 'Start a discussion about the saved node. Comments never answer a question.';
    const writable = state.storage?.scope === 'project' && !state.projectChange, enabled = writable && !state.pending && this.active() && this.canAct() && !this.flight;
    $('comments-access').textContent = writable ? 'Shared locally in this Project file. Commit and pull with Git to exchange comments.' : 'Read-only discussion. Open a current shared Project journey to post or resolve comments.';
    $('comments-post').disabled = !enabled || (thread ? status?.state === 'resolved' : !node);
    $('comments-post').textContent = draft.submission ? 'Retry previous post' : thread ? 'Post reply' : 'Start discussion';
    $('comments-resolve').hidden = !thread || status?.state === 'resolved'; $('comments-reopen').hidden = !thread || status?.state !== 'resolved';
    $('comments-resolve').disabled = $('comments-reopen').disabled = !enabled;
    $('comments-suggestion-area').hidden = !draft.suggestion && (thread?.source.kind ?? node?.kind ?? (node?.parentId === null ? 'idea' : 'question')) !== 'question';
    const stamp = JSON.stringify([thread, status, journey(state)]);
    if (stamp !== this.messageStamp) {
      this.messageStamp = stamp;
      $('comments-messages').replaceChildren(...(thread?.messages ?? []).map(message => {
        const parts = [el('p', { class: 'quiet' }, this.eventText(message.event)), el('p', { class: 'comment-text' }, message.text)];
        if (message.suggestion) parts.push(el('p', {}, 'Proposed answer wording'), el('pre', { class: 'comment-text' }, message.suggestion), button('Add to answer draft', async () => {
          const epoch = this.epoch, current = () => this.active() && $('comments-dialog').open && epoch === this.epoch && this.threadId === thread.id && journey(this.state()) === draft.journey && JSON.stringify(this.state().document?.comments?.threads.find(row => row.id === thread.id)?.messages.find(row => row.id === message.id)) === JSON.stringify(message);
          if (!current() || !this.canAct()) return;
          try { await this.append(thread.nodeId, message.suggestion, current); if (current()) $('comments-status').textContent = 'Added to your private answer draft. Review and save it through the ordinary answer workflow.'; }
          catch (error) { if (current()) $('comments-status').textContent = error.message; }
        }, { disabled: !status?.canSuggest }));
        return el('article', { class: 'comment-message' }, parts);
      }));
    }
  }
  async post(action) {
    const { $ } = this, state = this.state();
    if (!this.active() || !this.canAct() || !$('comments-dialog').open || this.flight || state.storage?.scope !== 'project' || state.pending || state.projectChange) return;
    const draft = this.draft(), posting = ['create', 'reply'].includes(action);
    let fields = { threadId: this.threadId };
    if (posting) {
      if (!draft.submission && (!draft.text.trim() || !draft.text.isWellFormed() || draft.text.length > 4000 || !draft.suggestion.isWellFormed() || draft.suggestion.length > 5000 || draft.suggestion && !draft.suggestion.trim())) { $('comments-status').textContent = 'Enter a comment up to 4,000 characters. Proposed wording must be blank or non-whitespace text up to 5,000 characters; use valid Unicode.'; return; }
      draft.submission ??= { ...(action === 'create' ? { nodeId: this.nodeId } : {}), threadId: this.threadId || $('comments-dialog').ownerDocument.defaultView.crypto.randomUUID(), messageId: $('comments-dialog').ownerDocument.defaultView.crypto.randomUUID(), text: draft.text, ...(draft.suggestion ? { suggestion: draft.suggestion } : {}) };
      fields = draft.submission; action = fields.nodeId ? 'create' : 'reply';
    }
    const identity = journey(state), epoch = ++this.epoch, abort = new AbortController(); this.flight = abort;
    const release = this.begin(); this.release = release;
    const current = () => this.active() && $('comments-dialog').open && epoch === this.epoch && identity === journey(this.state());
    const timer = setTimeout(() => abort.abort(), 30000); $('comments-status').textContent = 'Saving discussion…'; this.update();
    try {
      const response = await this.fetch('api/action', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: `comment-${action}`, revision: state.document.revision, journey: identity, ...fields }) });
      const result = await response.json(); if (!current()) return;
      if (!response.ok) {
        if (posting && result.commentSubmission === 'absent' && draft.submission === fields) draft.submission = null;
        throw Error(result.error);
      }
      if (journey(result) === identity && result.document?.revision >= this.state().document?.revision) this.apply(result);
      if (!posting) $('comments-status').textContent = action === 'resolve' ? 'Discussion resolved. The saved answer is unchanged.' : 'Discussion reopened.';
    } catch (error) {
      if (current()) $('comments-status').textContent = `${abort.signal.aborted ? 'The reply timed out; the post may have saved.' : error.message} Your composing text is retained. ${posting && !draft.submission ? 'The server confirmed this message is absent. Correct the draft and post again.' : 'Refresh the map or retry the previous post before starting another submission.'}`;
    } finally {
      clearTimeout(timer); if (this.flight === abort) { this.flight = null; release(); if (this.release === release) this.release = null; }
      if (current()) this.update();
    }
  }
}
