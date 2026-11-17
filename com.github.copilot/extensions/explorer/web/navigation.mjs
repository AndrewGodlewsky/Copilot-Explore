export function attachNavigation({ document, window, fetch, zoom, pan }) {
  const $ = id => document.getElementById(id);
  const defaults = { revision: 0, wheelMode: 'zoom', sensitivity: 1, motion: 'system' };
  let settings = { ...defaults }, revision = 0, loadError = '', saving = false, editVersion = 0, loadVersion = 0;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const effectiveMotion = () => settings.motion === 'system' ? (media.matches ? 'reduce' : 'full') : settings.motion;
  function apply() {
    document.documentElement.dataset.motion = effectiveMotion();
    const mode = settings.wheelMode === 'pan' ? 'pan' : 'zoom';
    $('navigation-hint').textContent = `Scroll to ${mode} · Ctrl/Command+scroll to zoom`;
    $('map-hint').textContent = `Drag to move. Scroll to ${mode}. Select a question to expand it.`;
    $('map').setAttribute('aria-label', `Question map. Drag the background, a card, or a question heading to pan. Scroll to ${mode}; Ctrl or Command plus scroll zooms. Plus and minus keys zoom; zero resets zoom; Home fits the visible map. Arrow keys pan. Escape collapses a question.`);
  }
  media.addEventListener?.('change', apply);
  function error(message) { $('navigation-error').textContent = message; $('navigation-error').hidden = !message; }
  function fields(value) {
    $('navigation-wheel').value = value.wheelMode;
    $('navigation-sensitivity').value = String(value.sensitivity);
    $('navigation-motion').value = value.motion;
  }
  for (const id of ['navigation-wheel', 'navigation-sensitivity', 'navigation-motion']) $(id).addEventListener('input', () => editVersion++);
  function setSaving(value) {
    saving = value;
    for (const id of ['navigation-wheel', 'navigation-sensitivity', 'navigation-motion', 'navigation-reset', 'navigation-cancel']) $(id).disabled = value;
    $('navigation-save').disabled = value || !!loadError;
  }
  async function refresh(preserveFields = false) {
    const currentLoad = ++loadVersion, currentEdit = editVersion;
    $('navigation-save').disabled = true;
    const previous = preserveFields ? { wheelMode: $('navigation-wheel').value, sensitivity: $('navigation-sensitivity').value, motion: $('navigation-motion').value } : null;
    try {
      const response = await fetch('api/navigation-settings');
      const result = await response.json();
      if (currentLoad !== loadVersion) return false;
      if (!response.ok) throw new Error(result.error || 'Navigation settings could not be loaded.');
      loadError = result.error || '';
      if (!loadError) {
        settings = result.settings; revision = settings.revision; apply();
        if (!preserveFields && currentEdit === editVersion) fields(settings);
      }
    } catch (cause) { if (currentLoad !== loadVersion) return false; loadError = cause.message; }
    if (previous && currentEdit === editVersion) fields(previous);
    error(loadError);
    $('navigation-save').disabled = !!loadError || saving;
    $('navigation-refresh').hidden = !loadError && !preserveFields;
    return !loadError;
  }
  function close() {
    $('navigation-dialog').close();
    $('navigation-open').focus({ preventScroll: true });
  }
  $('navigation-open').addEventListener('click', async () => {
    fields(settings); error(''); $('navigation-dialog').showModal(); $('navigation-wheel').focus();
    await refresh();
  });
  $('navigation-cancel').addEventListener('click', close);
  $('navigation-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('navigation-reset').addEventListener('click', () => { fields(defaults); editVersion++; error('Defaults selected. Save to apply them.'); });
  $('navigation-refresh').addEventListener('click', () => { void refresh(true); });
  $('navigation-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || loadError) return;
    const choice = { wheelMode: $('navigation-wheel').value, sensitivity: Number($('navigation-sensitivity').value), motion: $('navigation-motion').value };
    if (!$('navigation-sensitivity').value || !Number.isFinite(choice.sensitivity) || choice.sensitivity < .25 || choice.sensitivity > 3) {
      error('Sensitivity must be from 0.25 to 3.'); return;
    }
    ++loadVersion; setSaving(true); error('Saving navigation settings…');
    try {
      const response = await fetch('api/navigation-settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...choice, revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Navigation settings could not be saved.');
      settings = result.settings; revision = settings.revision; loadError = ''; apply(); close();
    } catch (cause) {
      error(cause.message); $('navigation-refresh').hidden = false;
    } finally { setSaving(false); }
  });
  apply();
  void refresh();
  return {
    wheel(event, rect) {
      if (event.target.closest('.expanded-node') && !event.ctrlKey && !event.metaKey) return;
      const multiplierX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1;
      const multiplierY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const dx = event.deltaX * multiplierX, dy = event.deltaY * multiplierY;
      if (!dx && !dy) return;
      event.preventDefault();
      if (settings.wheelMode === 'zoom' || event.ctrlKey || event.metaKey) {
        const delta = Math.max(-120, Math.min(120, dy * settings.sensitivity));
        if (delta) zoom(Math.exp(-delta * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        pan(-(dx || (event.shiftKey ? dy : 0)) * settings.sensitivity, -(event.shiftKey && !dx ? 0 : dy) * settings.sensitivity);
      }
    },
    get settings() { return settings; },
  };
}
