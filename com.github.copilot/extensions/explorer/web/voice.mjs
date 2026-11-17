export function matchesShortcut(event, shortcut) {
  return !!shortcut && event.code === shortcut.code && ['ctrl', 'alt', 'shift', 'meta'].every(key => !!event[key + 'Key'] === shortcut[key]);
}

export function attachVoice({ document, window, fetch, context, insert, changed }) {
  let settings, binding, recording, message = 'Checking local dictation…', checking = false;
  const hint = () => settings?.ready ? `${settings.mode === 'toggle' ? 'Press' : 'Hold'} ${settings.label} to dictate · local model` : settings?.error || 'Checking local dictation…';
  const show = text => { message = text; if (binding) binding.status.textContent = text; changed(); };
  const request = async (action, id, keepalive = false) => {
    const response = await fetch('api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, id }), keepalive });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  async function check() {
    if (checking || recording) return;
    checking = true;
    try { settings = await (await fetch('api/voice')).json(); if (!recording) show(hint()); }
    catch { settings = { ready: false }; show('Local dictation unavailable. Reopen Explorer to reconnect.'); }
    finally { checking = false; }
  }
  function cancel() {
    if (!recording) return;
    const old = recording; recording = null;
    void request('cancel', old.id, true).catch(() => {});
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
    else { job.phase = result.phase; show(result.phase === 'listening' ? `Listening… ${job.settings.mode === 'toggle' ? 'Press ' + job.settings.label + ' to finish' : 'Release to finish'} · Esc to cancel` : result.phase === 'transcribing' ? 'Transcribing locally…' : 'Loading local voice model… Wait for “Listening” before speaking.'); }
  }
  async function start() {
    if (!settings?.ready || !binding || recording) return;
    const answer = binding.answer;
    const job = recording = { id: window.crypto.randomUUID(), settings, context: context(), value: answer.value, start: answer.selectionStart, end: answer.selectionEnd, phase: 'loading' };
    show('Loading local voice model… Wait for “Listening” before speaking.');
    try { receive(job, await request('start', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
  }
  async function finish() {
    const job = recording;
    if (!job || job.finishing) return;
    job.finishing = true;
    try { receive(job, await request('finish', job.id)); }
    catch (error) { if (recording === job) { cancel(); show(error.message); } }
  }
  document.addEventListener('keydown', event => {
    if (recording && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
    const bindingSettings = recording?.settings || settings;
    if (document.activeElement !== binding?.answer || !bindingSettings?.ready || !matchesShortcut(event, bindingSettings.shortcut) || event.isComposing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (recording) { if (recording.settings.mode === 'toggle') void finish(); }
    else void start();
  }, true);
  document.addEventListener('keyup', event => {
    if (!recording || recording.settings.mode !== 'push_to_talk') return;
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
  }, 350);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  return {
    cancel,
    bind(answer, status) {
      binding = { answer, status }; status.textContent = message;
      answer.addEventListener('focus', () => { if (!recording) void check(); });
      answer.addEventListener('blur', cancel);
      answer.addEventListener('input', () => { if (recording && answer.value !== recording.value) cancel(); });
      if (recording && !sameContext(recording)) cancel();
      if (!settings) void check();
    },
  };
}
