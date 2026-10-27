'use strict';

// ---- Window manager with workspaces ----

const WM = (() => {
  const wins = new Map();
  const WS_COUNT = 4;
  let z = 100, seq = 0, activeId = null, ws = 0;

  const layer = () => $('#windows');
  const area = () => layer().getBoundingClientRect();

  function open(o) {
    if (o.single) {
      for (const w of wins.values()) if (w.app === o.app) { show(w.id); return w; }
    }
    const id = ++seq;
    const titleEl = el('span', { class: 'ttext' }, o.title || '');
    const btns = el('div', { class: 'tbtns' });
    if (!o.noMin) btns.append(el('button', { class: 'tbtn', title: 'Minimize', onclick: () => minimize(id) }, el('i', { class: 'g-min' })));
    if (!o.noMax && o.resizable !== false) btns.append(el('button', { class: 'tbtn', title: 'Maximize', onclick: () => toggleMax(id) }, el('i', { class: 'g-max' })));
    btns.append(el('button', { class: 'tbtn close', title: 'Close', onclick: () => close(id) }, '✕'));
    const bar = el('div', { class: 'titlebar' }, el('span', { class: 'ticon' }, o.icon || '🗔'), titleEl, btns);
    const body = el('div', { class: 'wbody' });
    const node = el('div', { class: 'window raised', tabindex: '-1' }, bar, body);
    if (o.resizable !== false) node.append(el('div', { class: 'resize' }));

    const a = area();
    node.style.width = Math.min(o.width || 480, a.width - 8) + 'px';
    if (o.height !== 'auto') node.style.height = Math.min(o.height || 360, a.height - 8) + 'px';
    const off = ((id - 1) % 8) * 26;
    node.style.left = (o.x ?? 70 + off) + 'px';
    node.style.top = (o.y ?? 24 + off) + 'px';

    const w = {
      id, app: o.app, node, body, ws, icon: o.icon || '🗔', noTask: !!o.noTask,
      minimized: false, maximized: false, onClose: o.onClose, onResize: o.onResize,
      get title() { return titleEl.textContent; },
      setTitle(t) { if (titleEl.textContent !== t) { titleEl.textContent = t; renderTaskbar(); } },
      close: () => close(id),
      focus: () => focus(id),
    };
    wins.set(id, w);
    layer().append(node);

    bar.addEventListener('dblclick', e => {
      if (!e.target.closest('button') && o.resizable !== false && !o.noMax) toggleMax(id);
    });
    node.addEventListener('pointerdown', () => focus(id), true);
    makeDraggable(w, bar);
    if (o.resizable !== false) makeResizable(w, node.querySelector('.resize'));

    focus(id);
    renderTaskbar();
    Bus.emit('windows');
    return w;
  }

  function makeDraggable(w, handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button') || w.maximized) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = w.node.offsetLeft, oy = w.node.offsetTop;
      const a = area();
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        w.node.style.left = Math.max(80 - w.node.offsetWidth, Math.min(a.width - 80, ox + ev.clientX - sx)) + 'px';
        w.node.style.top = Math.max(0, Math.min(a.height - 24, oy + ev.clientY - sy)) + 'px';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function makeResizable(w, h) {
    h.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ow = w.node.offsetWidth, oh = w.node.offsetHeight;
      h.setPointerCapture(e.pointerId);
      const move = ev => {
        w.node.style.width = Math.max(220, ow + ev.clientX - sx) + 'px';
        w.node.style.height = Math.max(120, oh + ev.clientY - sy) + 'px';
        w.onResize?.();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
  }

  function center(w) {
    const a = area(), r = w.node.getBoundingClientRect();
    w.node.style.left = Math.max(0, (a.width - r.width) / 2) + 'px';
    w.node.style.top = Math.max(0, (a.height - r.height) / 2.6) + 'px';
  }

  function focus(id) {
    const w = wins.get(id);
    if (!w || (activeId === id && +w.node.style.zIndex === z)) return;
    w.node.style.zIndex = ++z;
    for (const o of wins.values()) o.node.classList.toggle('active', o.id === id);
    activeId = id;
    renderTaskbar();
  }

  function focusTop() {
    let best = null;
    for (const w of wins.values()) {
      if (w.ws === ws && !w.minimized && (!best || +w.node.style.zIndex > +best.node.style.zIndex)) best = w;
    }
    if (best) focus(best.id);
    else { activeId = null; for (const o of wins.values()) o.node.classList.remove('active'); renderTaskbar(); }
  }

  function close(id) {
    const w = wins.get(id);
    if (!w) return;
    if (w.onClose && w.onClose() === false) return;
    w.node.remove();
    wins.delete(id);
    if (activeId === id) { activeId = null; focusTop(); }
    renderTaskbar();
    Bus.emit('windows');
  }

  function minimize(id) {
    const w = wins.get(id);
    if (!w) return;
    w.minimized = true;
    w.node.style.display = 'none';
    if (activeId === id) { activeId = null; focusTop(); }
    renderTaskbar();
  }

  function show(id) {
    const w = wins.get(id);
    if (!w) return;
    if (w.ws !== ws) setWorkspace(w.ws);
    w.minimized = false;
    w.node.style.display = '';
    focus(id);
    renderTaskbar();
  }

  function toggleMax(id) {
    const w = wins.get(id);
    if (!w) return;
    w.maximized = !w.maximized;
    w.node.classList.toggle('max', w.maximized);
    w.onResize?.();
  }

  function setWorkspace(n) {
    ws = (n + WS_COUNT) % WS_COUNT;
    for (const w of wins.values()) w.node.style.display = w.ws === ws && !w.minimized ? '' : 'none';
    activeId = null;
    focusTop();
    renderTaskbar();
    Bus.emit('workspace', ws);
  }

  function moveTo(id, n) {
    const w = wins.get(id);
    if (!w) return;
    w.ws = n;
    setWorkspace(ws);
  }

  function showDesktop() {
    const mine = [...wins.values()].filter(w => w.ws === ws && !w.noTask);
    const allMin = mine.every(w => w.minimized);
    for (const w of mine) allMin ? show(w.id) : minimize(w.id);
  }

  function closeAll() {
    for (const w of [...wins.values()]) { w.onClose = null; close(w.id); }
  }

  function renderTaskbar() {
    const bar = $('#task-buttons');
    if (!bar) return;
    bar.innerHTML = '';
    for (const w of wins.values()) {
      if (w.ws !== ws || w.noTask) continue;
      const on = w.id === activeId && !w.minimized;
      const b = el('button', { class: 'task-btn btn' + (on ? ' active' : ''), title: w.title },
        el('span', { class: 'ti' }, w.icon), el('span', { class: 't' }, w.title));
      b.onclick = () => (on ? minimize(w.id) : show(w.id));
      b.oncontextmenu = e => {
        e.preventDefault();
        UI.menu(e.clientX, e.clientY - 150, [
          { label: 'Restore', icon: '🗗', disabled: !w.minimized && !w.maximized, action: () => { if (w.maximized) toggleMax(w.id); show(w.id); } },
          { label: 'Minimize', icon: '🗕', disabled: w.minimized, action: () => minimize(w.id) },
          { label: 'Maximize', icon: '🗖', disabled: w.maximized, action: () => { show(w.id); toggleMax(w.id); } },
          { label: 'Move to Workspace', icon: '🗂️', items: [0, 1, 2, 3].map(i => ({ label: `Workspace ${i + 1}`, checked: w.ws === i, action: () => moveTo(w.id, i) })) },
          '-',
          { label: 'Close', icon: '✕', hint: 'Alt+F4', action: () => close(w.id) },
        ]);
      };
      bar.append(b);
    }
    document.querySelectorAll('.ws-switch button').forEach((b, i) => {
      b.classList.toggle('on', i === ws);
      b.classList.toggle('busy', [...wins.values()].some(w => w.ws === i && !w.noTask));
    });
  }

  return {
    open, close, focus, minimize, show, toggleMax, center, setWorkspace, moveTo, showDesktop, closeAll, renderTaskbar,
    list: () => [...wins.values()],
    active: () => wins.get(activeId),
    get workspace() { return ws; },
    WS_COUNT,
  };
})();
