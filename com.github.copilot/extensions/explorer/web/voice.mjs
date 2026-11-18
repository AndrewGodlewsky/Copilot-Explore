export function matchesShortcut(event, shortcut) {
  return !!shortcut && event.code === shortcut.code && ['ctrl', 'alt', 'shift', 'meta'].every(key => !!event[key + 'Key'] === shortcut[key]);
}

export function attachVoice({ document, window, fetch, context, insert, changed }) {
  let settings, binding, recording, message = 'Checking local dictation…', checking = false, pendingRelease = Promise.resolve();
  let options, choices, settingsOpen = false, optionsBusy = false, optionsMessage = '', feedback = { phase: 'idle' };
  let timer = null, suspended = false, disposed = false;
  const hint = () => settings?.ready ? `${settings.mode === 'toggle' ? 'Press' : 'Hold'} ${settings.label} to dictate · local model` : settings?.error || 'Checking local dictation…';
  const show = (text, result = { phase: 'idle' }) => {
    const resized = message !== text || feedback.phase !== result.phase;
    message = text; feedback = result; paintFeedback(); lockControls(); if (resized) changed();
  };
  function element(tag, className, text) {
    const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
  }
  function paintFeedback() {
    if (!binding) return;
    const { status, bar, bars, elapsed, activity } = binding;
    if (status.textContent !== message) status.textContent = message;
    bar.dataset.phase = feedback.phase; bar.hidden = !['loading', 'listening', 'transcribing'].includes(feedback.phase);
    activity.textContent = feedback.phase === 'listening' ? 'Listening' : feedback.phase === 'transcribing' ? 'Transcribing' : 'Loading model';
    const levels = (feedback.levels || []).slice(-24);
    bars.forEach((b, i) => { const level = levels[i - (24 - levels.length)]; b.style.height = `${2 + 26 * (Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0)}px`; });
    const seconds = Math.floor(Math.max(0, feedback.elapsedMs || 0) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function lockControls() {
    if (!binding) return;
    const focused = document.activeElement;
    binding.mic.disabled = binding.model.disabled = binding.save.disabled = optionsBusy || !!recording || !options;
    binding.refresh.disabled = optionsBusy || !!recording;
    binding.record.disabled = suspended || disposed || !settings?.ready || optionsBusy || !!recording;
    binding.stop.disabled = !recording || recording.phase !== 'listening' || !!recording.finishing;
    binding.cancel.disabled = !recording;
    if (focused === binding.record && recording) {
      recording.followRecordFocus = true;
      binding.cancel.focus({ preventScroll: true });
    } else if (recording?.followRecordFocus && recording.phase === 'listening') {
      recording.followRecordFocus = false;
      if (focused === binding.cancel) binding.stop.focus({ preventScroll: true });
    } else if (focused === binding.stop && binding.stop.disabled) {
      (recording ? binding.cancel : binding.answer).focus({ preventScroll: true });
    } else if (focused === binding.cancel && binding.cancel.disabled) binding.answer.focus({ preventScroll: true });
  }
  function paintChoices() {
    if (!binding) return;
    const { mic, model, note } = binding;
    note.textContent = optionsMessage;
    const populate = (select, items, value) => {
      select.replaceChildren();
      for (const item of items) { const opt = element('option', '', item.label); opt.value = item.value; opt.disabled = item.disabled; opt.title = item.reason || ''; select.append(opt); }
      if (!items.some(i => i.value === value)) { const opt = element('option', '', `Unavailable: ${value}`); opt.value = value; opt.disabled = true; select.append(opt); }
      select.value = value;
    };
    populate(mic, [{ value: '', label: 'System default microphone' }, ...(options?.microphones || []).map(d => ({ value: d.name, label: d.name + (d.supported ? '' : ' — duplicate name'), disabled: !d.supported }))], choices?.microphone || '');
    populate(model, [{ value: 'copilot', label: `Follow Copilot${options ? ' — ' + options.copilotModel : ''}` }, ...(options?.models || []).map(m => ({ value: m.id, label: m.label + (m.supported ? '' : /incomplete/i.test(m.reason) ? ' — incomplete download' : ' — unsupported'), disabled: !m.supported, reason: m.reason }))], choices?.model || 'copilot');
    lockControls(); changed();
  }
  async function loadOptions(save = false) {
    if (optionsBusy || recording) return;
    optionsBusy = true; optionsMessage = save ? 'Saving voice settings…' : 'Checking microphones and downloaded models…'; paintChoices();
    try {
      const response = await fetch('api/voice/settings', save ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...choices, revision: options.preferences.revision }) } : undefined);
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      options = result; settings = result;
      if (!choices || save) choices = { microphone: result.preferences.microphone, model: result.preferences.model };
      optionsMessage = result.error || (save ? 'Saved for Explorer. Copilot settings are unchanged.' : 'Only downloaded models are listed. Unsupported models cannot be selected.');
      if (!recording) show(hint());
    } catch (error) { optionsMessage = error.message + ' Use Refresh to try again.'; }
    finally { optionsBusy = false; paintChoices(); }
  }
  function buildControls(answer, root) {
    const status = element('p', 'quiet voice-status'); status.id = 'voice-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const voiceActions = element('div', 'voice-actions');
    const record = element('button', '', 'Record'), stop = element('button', '', 'Stop'), discard = element('button', '', 'Cancel');
    record.id = 'voice-record'; stop.id = 'voice-stop'; discard.id = 'voice-cancel';
    record.type = stop.type = discard.type = 'button'; voiceActions.append(record, stop, discard);
    let pointerSelection;
    record.addEventListener('pointerdown', () => { pointerSelection = { start: answer.selectionStart, end: answer.selectionEnd }; });
    record.addEventListener('pointercancel', () => { pointerSelection = null; });
    record.addEventListener('click', event => { void start('button', event.detail > 0 ? pointerSelection : null); pointerSelection = null; });
    stop.addEventListener('click', () => { void finish(); answer.focus({ preventScroll: true }); });
    discard.addEventListener('click', () => { cancel(); answer.focus({ preventScroll: true }); });
    const bar = element('div', 'voice-feedback'); bar.id = 'voice-feedback'; bar.setAttribute('aria-hidden', 'true');
    const activity = element('span', 'voice-activity'), spinner = element('span', 'voice-spinner'), meter = element('span', 'voice-meter'), elapsed = element('span', 'voice-elapsed');
    const bars = Array.from({ length: 24 }, () => element('i', 'voice-level')); meter.append(...bars); bar.append(spinner, activity, meter, elapsed);
    const details = element('details', 'voice-settings'); details.id = 'voice-settings'; details.open = settingsOpen;
    const summary = element('summary', '', 'Voice settings'), fields = element('div', 'voice-fields');
    const mic = element('select'), model = element('select'); mic.id = 'voice-microphone'; model.id = 'voice-model';
    for (const [select, name] of [[mic, 'Microphone'], [model, 'Downloaded voice model']]) {
      const label = element('label', '', name); label.htmlFor = select.id; fields.append(label, select);
      select.addEventListener('change', () => { choices = { microphone: mic.value, model: model.value }; optionsMessage = 'Unsaved voice settings. Save to use these choices.'; binding.note.textContent = optionsMessage; changed(); });
    }
    const save = element('button', '', 'Save voice settings'), refresh = element('button', '', 'Refresh devices and models'), actions = element('div', 'voice-settings-actions');
    save.type = refresh.type = 'button'; refresh.id = 'voice-refresh'; actions.append(save, refresh);
    save.addEventListener('click', () => { void loadOptions(true); }); refresh.addEventListener('click', () => { void loadOptions(); });
    const note = element('p', 'quiet'); note.setAttribute('role', 'status');
    fields.append(actions, note, element('p', 'quiet', 'Your shortcut and recording mode follow Copilot. Model downloads are managed in Copilot.'));
    details.append(summary, fields); root.replaceChildren(voiceActions, bar, status, details);
    binding = { answer, root, record, stop, cancel: discard, status, bar, bars, elapsed, activity, mic, model, save, refresh, note };
    details.addEventListener('toggle', () => { if (!details.isConnected) return; settingsOpen = details.open; if (settingsOpen && !options) void loadOptions(); changed(); });
    paintFeedback(); paintChoices();
  }
  const request = async (action, id, keepalive = false, sequence) => {
    const response = await fetch('api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, id, ...(sequence === undefined ? {} : { sequence }) }), keepalive });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  async function check() {
    if (checking || recording || optionsBusy) return;
    checking = true;
    try { const result = await (await fetch('api/voice')).json(); if (!optionsBusy) { settings = result; if (!recording) show(hint()); } }
    catch { settings = { ready: false }; show('Local dictation unavailable. Reopen Explorer to reconnect.'); }
    finally { checking = false; }
  }
  function cancel() {
    if (!recording) return;
    const old = recording; recording = null;
    pendingRelease = Promise.allSettled([pendingRelease, request('cancel', old.id, true)]).then(() => {});
    show('Dictation cancelled. ' + retained(old) + hint());
  }
  const retained = job => `${job.savedCount ? `${job.savedCount} chunk${job.savedCount === 1 ? '' : 's'} retained in your local draft. ` : ''}${job.lastSequence > job.savedCount ? 'Visible text is not yet confirmed saved; check draft recovery. ' : ''}`;
  function sameContext(job) {
    return binding && job.context === context() && binding.answer.value === job.value && binding.answer.selectionStart === job.caretStart && binding.answer.selectionEnd === job.caretEnd;
  }
  function receive(job, result) {
    if (recording !== job) return;
    if (result.id !== job.id) return;
    if (!sameContext(job)) return cancel();
    if ((job.finishing || job.phase === 'transcribing') && result.phase === 'listening') result = { ...result, phase: 'transcribing' };
    const legacy = result.phase === 'done' && typeof result.text === 'string' && !job.lastSequence;
    const segment = result.segment || (legacy && result.text.trim() ? { sequence: 1, text: result.text.trim() } : null);
    if (segment && segment.sequence > job.lastSequence && !job.saving) {
      if (!Number.isSafeInteger(segment.sequence) || segment.sequence !== job.lastSequence + 1 || typeof segment.text !== 'string' || !segment.text.length || segment.text.length > (legacy ? 20000 : 4096)) {
        cancel(); return show('Dictation stopped after an out-of-order or invalid chunk. ' + retained(job));
      }
      const transcript = job.transcript + segment.text;
      const addition = `${job.before && !/\s$/.test(job.before) && !/^\s/.test(transcript) ? ' ' : ''}${transcript}${job.after && !/\s$/.test(transcript) && !/^\s|^[.,!?;:]/.test(job.after) ? ' ' : ''}`;
      const value = job.before + addition + job.after, caret = job.before.length + addition.length;
      if (value.length > 20000) { cancel(); return show('Dictation would exceed the answer limit. The new chunk was not inserted. ' + retained(job) + 'Shorten your draft and try again.'); }
      job.transcript = transcript; job.lastSequence = segment.sequence; job.saving = true;
      const saved = insert(value, caret);
      job.value = value; job.caretStart = job.caretEnd = caret; job.context = context();
      void Promise.resolve(saved).then(async () => {
        job.savedCount++;
        if (recording !== job || !sameContext(job)) { if (recording === job) cancel(); return; }
        const next = legacy ? { id: job.id, phase: 'done' } : await request('ack', job.id, false, segment.sequence);
        job.saving = false; receive(job, next);
      }).catch(error => {
        if (recording !== job) return;
        cancel(); show(`Dictation stopped. ${job.savedCount === job.lastSequence ? 'Text was saved locally, but dictation could not acknowledge it.' : 'Visible text could not be saved.'} ${error.message} Use the draft recovery controls; review retained text before retrying.`);
      });
    }
    if (job.saving) {
      if (['listening', 'transcribing'].includes(result.phase)) job.phase = result.phase;
      if (['done', 'error', 'cancelled'].includes(result.phase)) job.phase = 'transcribing';
      return show(`Saving dictated text locally… ${retained(job)}${result.error || result.note || ''}`, { ...result, phase: job.phase });
    }
    if (result.phase === 'done') {
      recording = null;
      if (!job.transcript.trim()) return show('No speech recognized. ' + hint());
      show('Dictation added to your draft. ' + retained(job) + (result.note || '') + ' Review it before saving an answer.');
    } else if (['cancelled', 'error'].includes(result.phase)) { recording = null; show((result.error || 'Dictation stopped.') + ' ' + retained(job) + 'Record again to retry the remaining speech.'); }
    else { job.phase = result.phase; show(result.phase === 'listening' ? `Listening… ${job.initiator === 'button' ? 'Select Stop or press ' + job.settings.label + ' to finish' : job.settings.mode === 'toggle' ? 'Press ' + job.settings.label + ' to finish' : 'Release to finish'} · Esc to cancel · ${job.savedCount} chunks saved locally` : result.phase === 'transcribing' ? 'Finishing captured audio locally… Cancel keeps inserted draft text. ' + (result.note || '') : 'Loading local voice model… Wait for “Listening” before speaking.', result); }
  }
  async function start(initiator = 'shortcut', selection) {
    if (suspended || disposed || !settings?.ready || !binding || recording || optionsBusy) return;
    const answer = binding.answer;
    const start = selection?.start ?? answer.selectionStart, end = selection?.end ?? answer.selectionEnd;
    const job = recording = { id: window.crypto.randomUUID(), settings, initiator, context: context(), value: answer.value, before: answer.value.slice(0, start), after: answer.value.slice(end), caretStart: answer.selectionStart, caretEnd: answer.selectionEnd, transcript: '', lastSequence: 0, savedCount: 0, phase: 'loading' };
    show('Loading local voice model… Wait for “Listening” before speaking.', { phase: 'loading' });
    try { await pendingRelease; if (recording === job) receive(job, await request('start', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
  }
  async function finish() {
    const job = recording;
    if (!job || job.finishing || job.phase === 'transcribing') return;
    if (job.phase === 'loading') { cancel(); show('Stopped before Listening; no audio was captured. ' + hint()); return; }
    if (job.phase !== 'listening') return;
    job.finishing = true;
    lockControls();
    try { receive(job, await request('finish', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
  }
  document.addEventListener('keydown', event => {
    if (recording && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
    const bindingSettings = recording?.settings || settings;
    if (!(document.activeElement === binding?.answer || binding?.root.contains(document.activeElement)) || !bindingSettings?.ready || !matchesShortcut(event, bindingSettings.shortcut) || event.isComposing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (recording) { if (recording.initiator === 'button' || recording.settings.mode === 'toggle') void finish(); }
    else void start();
  }, true);
  document.addEventListener('keyup', event => {
    if (!recording || recording.initiator !== 'shortcut' || recording.settings.mode !== 'push_to_talk') return;
    const shortcut = recording.settings.shortcut;
    if (event.code === shortcut.code || ['ctrl', 'alt', 'shift', 'meta'].some(key => shortcut[key] && !event[key + 'Key'])) {
      event.preventDefault(); event.stopImmediatePropagation(); void finish();
    }
  }, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  async function poll() {
    const job = recording; if (!job || job.polling) return;
    if (!sameContext(job)) return cancel();
    job.polling = true;
    try { receive(job, await request('poll', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
    finally { job.polling = false; }
  }
  const startPolling = () => { if (timer === null && !suspended && !disposed) timer = window.setInterval(poll, 200); };
  window.addEventListener('pagehide', event => {
    suspended = true; disposed ||= !event.persisted;
    window.clearInterval(timer); timer = null; cancel(); lockControls();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted || disposed || !suspended) return;
    suspended = false; startPolling(); lockControls();
  });
  startPolling();
  return {
    cancel,
    allowsShortcut(event) {
      const current = recording?.settings || settings;
      return !!current?.shortcut && !checking && !optionsBusy && !matchesShortcut(event, current.shortcut);
    },
    bind(answer, root) {
      if (recording && !sameContext(recording)) cancel();
      buildControls(answer, root);
      answer.addEventListener('focus', () => { if (!recording) void check(); });
      const leave = () => window.setTimeout(() => {
        if (recording && document.activeElement !== binding?.answer && !binding?.root.contains(document.activeElement)) cancel();
      }, 0);
      answer.addEventListener('blur', leave);
      root.addEventListener('focusout', leave);
      answer.addEventListener('input', () => { if (recording && answer.value !== recording.value) cancel(); });
      if (!settings) void check();
    },
  };
}
