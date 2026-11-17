export function matchesShortcut(event, shortcut) {
  return !!shortcut && event.code === shortcut.code && ['ctrl', 'alt', 'shift', 'meta'].every(key => !!event[key + 'Key'] === shortcut[key]);
}

export function attachVoice({ document, window, fetch, context, insert, changed }) {
  let settings, binding, recording, message = 'Checking local dictation…', checking = false, pendingRelease = Promise.resolve();
  let options, choices, settingsOpen = false, optionsBusy = false, optionsMessage = '', feedback = { phase: 'idle' };
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
    binding.mic.disabled = binding.model.disabled = binding.save.disabled = optionsBusy || !!recording || !options;
    binding.refresh.disabled = optionsBusy || !!recording;
    binding.record.disabled = !settings?.ready || optionsBusy || !!recording;
    binding.stop.disabled = !recording || recording.phase !== 'listening' || !!recording.finishing;
    binding.cancel.disabled = !recording;
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
    record.addEventListener('click', () => { void start('button', pointerSelection); pointerSelection = null; });
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
  const request = async (action, id, keepalive = false) => {
    const response = await fetch('api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, id }), keepalive });
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
    show('Dictation cancelled. ' + hint());
  }
  function sameContext(job) {
    return binding && job.context === context() && binding.answer.value === job.value;
  }
  function receive(job, result) {
    if (recording !== job) return;
    if (!sameContext(job)) return cancel();
    if (result.phase === 'done') {
      recording = null;
      const text = result.text?.trim() || '';
      if (!text) return show('No speech recognized. ' + hint());
      const before = job.value.slice(0, job.start), after = job.value.slice(job.end);
      const addition = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s|^[.,!?;:]/.test(after) ? ' ' : ''}`;
      const value = before + addition + after;
      if (value.length > 20000) return show('Dictation would exceed the answer limit. Shorten your draft and try again.');
      insert(value, before.length + addition.length);
      show('Dictation added to your draft. Review it before saving.');
    } else if (['cancelled', 'error'].includes(result.phase)) { recording = null; show(result.error || 'Dictation stopped.'); }
    else { job.phase = result.phase; show(result.phase === 'listening' ? `Listening… ${job.initiator === 'button' ? 'Select Stop or press ' + job.settings.label + ' to finish' : job.settings.mode === 'toggle' ? 'Press ' + job.settings.label + ' to finish' : 'Release to finish'} · Esc to cancel` : result.phase === 'transcribing' ? 'Transcribing locally… Cancel to discard.' : 'Loading local voice model… Wait for “Listening” before speaking.', result); }
  }
  async function start(initiator = 'shortcut', selection) {
    if (!settings?.ready || !binding || recording || optionsBusy) return;
    const answer = binding.answer;
    const job = recording = { id: window.crypto.randomUUID(), settings, initiator, context: context(), value: answer.value, start: selection?.start ?? answer.selectionStart, end: selection?.end ?? answer.selectionEnd, phase: 'loading' };
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
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  const timer = window.setInterval(async () => {
    const job = recording; if (!job || job.polling) return;
    if (!sameContext(job)) return cancel();
    job.polling = true;
    try { receive(job, await request('poll', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
    finally { job.polling = false; }
  }, 200);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  return {
    cancel,
    bind(answer, root) {
      buildControls(answer, root);
      answer.addEventListener('focus', () => { if (!recording) void check(); });
      const leave = () => window.setTimeout(() => {
        if (recording && document.activeElement !== binding?.answer && !binding?.root.contains(document.activeElement)) cancel();
      }, 0);
      answer.addEventListener('blur', leave);
      root.addEventListener('focusout', leave);
      answer.addEventListener('input', () => { if (recording && answer.value !== recording.value) cancel(); });
      if (recording && !sameContext(recording)) cancel();
      if (!settings) void check();
    },
  };
}
