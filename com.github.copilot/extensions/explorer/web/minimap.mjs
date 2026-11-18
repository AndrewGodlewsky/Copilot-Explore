// Projection of the current logical scene, including the counter-scaled editor.
export function projectOverview(bounds, width, height) {
  const scale = Math.min((width - 8) / Math.max(1, bounds.right - bounds.left), (height - 8) / Math.max(1, bounds.bottom - bounds.top));
  const x = width / 2 - (bounds.left + bounds.right) / 2 * scale;
  const y = height / 2 - (bounds.top + bounds.bottom) / 2 * scale;
  const point = (px, py) => ({ x: x + px * scale, y: y + py * scale });
  return { point, scale, world: (px, py) => ({ x: (px - x) / scale, y: (py - y) / scale }),
    viewport(view, size) {
      const a = point(-view.x / view.zoom, -view.y / view.zoom);
      const b = point((size.width - view.x) / view.zoom, (size.height - view.y) / view.zoom);
      const left = Math.max(0, Math.min(width, a.x)), top = Math.max(0, Math.min(height, a.y));
      return { x: left, y: top, width: Math.max(0, Math.min(width, b.x)) - left, height: Math.max(0, Math.min(height, b.y)) - top };
    } };
}

export function overviewPaths(positions, projection, selected, collapsed, focusId) {
  const paths = { nodes: '', folded: '', focus: '', selected: '' };
  for (const [id, box] of positions) {
    const p = projection.point(box.x, box.y), w = box.width * projection.scale, h = box.height * projection.scale;
    const path = `M${p.x},${p.y}h${w}v${h}h${-w}Z`;
    paths.nodes += path;
    if (collapsed.has(id)) paths.folded += path;
    if (focusId === id) paths.focus += path;
    if (selected === id) paths.selected += path;
  }
  return paths;
}

export function attachMinimap({ document, window, scene, navigate, leaveEditor }) {
  const $ = id => document.getElementById(id), root = $('minimap'), svg = $('minimap-map'), toggle = $('minimap-toggle');
  let cached = null, projection = null, pointer = null, disposed = false, suspended = false, wanted = false;
  const listeners = [];
  const on = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
  function cancel(event) {
    if (!pointer || event?.pointerId !== undefined && event.pointerId !== pointer.id) return;
    const id = pointer.id; pointer = null;
    if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id);
  }
  function reset() {
    cancel(); cached = null; projection = null;
    for (const name of ['nodes', 'folded', 'focus', 'selected']) $(`minimap-${name}`).setAttribute('d', '');
    $('minimap-viewport').setAttribute('width', '0'); $('minimap-viewport').setAttribute('height', '0');
    $('minimap-status').textContent = '';
  }
  function update() {
    if (disposed || suspended || root.hidden) return;
    const current = scene(), rect = svg.getBoundingClientRect();
    if (!current?.geometry || !rect.width || !rect.height) { reset(); return; }
    const { geometry, selected, collapsed, focusId, view, size } = current;
    if (!cached || cached.geometry !== geometry || cached.selected !== selected || cached.collapsed !== collapsed || cached.focusId !== focusId || cached.width !== rect.width || cached.height !== rect.height) {
      cancel();
      projection = projectOverview(geometry.bounds, rect.width, rect.height);
      svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      const paths = overviewPaths(geometry.positions, projection, selected, collapsed, focusId);
      for (const [name, path] of Object.entries(paths)) $(`minimap-${name}`).setAttribute('d', path);
      let folds = 0; for (const id of collapsed) if (geometry.positions.has(id)) folds++;
      $('minimap-status').textContent = `${geometry.positions.size} shown; ${folds} folded${focusId ? '; branch focus' : '; whole map'}.`;
      cached = { geometry, selected, collapsed, focusId, width: rect.width, height: rect.height };
    }
    for (const [name, value] of Object.entries(projection.viewport(view, size))) $('minimap-viewport').setAttribute(name, value);
  }
  function visible(show, refresh = true) {
    if (disposed) return;
    wanted = show; root.hidden = !show || suspended; toggle.setAttribute('aria-expanded', String(show));
    toggle.textContent = show ? 'Hide minimap' : 'Show minimap';
    root.parentElement.classList.toggle('minimap-visible', show && !suspended);
    reset(); if (show && !suspended && refresh) update();
  }
  function current() { return !disposed && !suspended && !root.hidden && projection && scene(); }
  function moveTo(event) {
    if (!current()) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width !== cached.width || rect.height !== cached.height) { update(); return; }
    const p = projection.world(Math.max(0, Math.min(rect.width, event.clientX - rect.left)), Math.max(0, Math.min(rect.height, event.clientY - rect.top)));
    navigate(p);
  }
  on(toggle, 'focus', leaveEditor);
  on(toggle, 'click', () => { leaveEditor(); visible(!wanted); });
  on(svg, 'focus', leaveEditor);
  on(svg, 'blur', () => cancel());
  on(svg, 'pointerdown', event => {
    if (!current() || pointer || event.isPrimary === false || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); leaveEditor(); svg.focus({ preventScroll: true });
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    svg.setPointerCapture(event.pointerId);
  });
  on(window, 'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!event.buttons) { cancel(event); return; }
    if (!pointer.moved && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 4) return;
    pointer.moved = true; event.preventDefault(); moveTo(event);
  });
  on(window, 'pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const moved = pointer.moved; cancel(event);
    if (!moved) moveTo(event);
  });
  on(window, 'pointercancel', cancel); on(svg, 'lostpointercapture', cancel); on(window, 'blur', () => cancel());
  on(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  on(svg, 'keydown', event => {
    const value = current();
    if (!value || event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') { event.preventDefault(); cancel(); visible(false); toggle.focus({ preventScroll: true }); return; }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction && !['Home', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat && !direction) return;
    cancel(); leaveEditor();
    const { view, size, geometry: { bounds } } = value;
    navigate(direction ? { x: (size.width / 2 - view.x + direction[0] * size.width / 4) / view.zoom, y: (size.height / 2 - view.y + direction[1] * size.height / 4) / view.zoom } :
      { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
  });
  const observer = new window.ResizeObserver(update); observer.observe(svg);
  return { update, reset, suspend(value) { if (suspended === value) return; suspended = value; visible(wanted, false); }, dispose() { disposed = true; reset(); observer.disconnect(); for (const remove of listeners) remove(); } };
}
