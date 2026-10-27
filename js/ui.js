'use strict';

// ---- Menus, dialogs, notifications ----

const UI = {
  closeMenus() {
    document.querySelectorAll('.ctx-menu, .calendar').forEach(m => m.remove());
    document.querySelectorAll('.menubar > span.open').forEach(s => s.classList.remove('open'));
    $('#start-btn')?.classList.remove('pressed');
  },

  closeSub(m) {
    if (!m._sub) return;
    this.closeSub(m._sub);
    m._sub.remove();
    m._sub = null;
  },

  // items: [{label, icon, hint, action, items, checked, disabled} | '-']
  menu(x, y, items, { parent, cls, banner } = {}) {
    if (!parent) this.closeMenus();
    const m = el('div', { class: 'ctx-menu raised' + (cls ? ' ' + cls : '') });
    let body = m;
    if (banner) {
      m.append(el('div', { class: 'sm-banner' }, el('span', {}, el('b', {}, banner.split(' ')[0]), ' ' + banner.split(' ').slice(1).join(' '))));
      body = el('div', { class: 'sm-items' });
      m.append(body);
    }
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { body.append(el('div', { class: 'sep' })); continue; }
      const row = el('div', { class: 'mi' + (it.disabled ? ' disabled' : '') },
        el('span', { class: 'mi-icon' }, it.checked ? '✔' : (it.icon || '')),
        el('span', { class: 'mi-label' }, it.label),
        it.items ? el('span', { class: 'mi-arrow' }, '▶') : (it.hint ? el('span', { class: 'mi-hint' }, it.hint) : ''));
      row.addEventListener('mouseenter', () => {
        this.closeSub(m);
        if (it.items && !it.disabled) {
          const r = row.getBoundingClientRect();
          const sub = it.items.length ? it.items : [{ label: '(Empty)', disabled: true }];
          m._sub = this.menu(r.right - 3, r.top - 3, sub, { parent: m });
          if (m._sub.getBoundingClientRect().left < r.right - 10) m._sub.style.left = Math.max(0, r.left - m._sub.offsetWidth + 3) + 'px';
        }
      });
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (it.disabled || it.items) return;
        this.closeMenus();
        it.action?.();
      });
      body.append(row);
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(0, Math.min(x, innerWidth - r.width - 2)) + 'px';
    m.style.top = Math.max(0, Math.min(y, innerHeight - r.height - 2)) + 'px';
    return m;
  },

  // spec: [{label, items: [...] | () => [...]}]
  menubar(spec) {
    const bar = el('div', { class: 'menubar' });
    for (const s of spec) {
      const lab = el('span', {}, s.label);
      lab.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = lab.classList.contains('open');
        this.closeMenus();
        if (wasOpen) return;
        const r = lab.getBoundingClientRect();
        this.menu(r.left, r.bottom, typeof s.items === 'function' ? s.items() : s.items);
        lab.classList.add('open');
      });
      bar.append(lab);
    }
    return bar;
  },

  dialog({ title = 'IROS', message = '', icon = 'ℹ️', buttons = ['OK'], input = null, width = 360, extra = null }) {
    return new Promise(resolve => {
      let done = false;
      const w = WM.open({
        title, icon, width, height: 'auto', resizable: false, noMin: true, noMax: true, noTask: true,
        onClose: () => { if (!done) { done = true; resolve(null); } },
      });
      const inp = input != null ? el('input', { class: 'field', value: input, spellcheck: 'false' }) : null;
      const finish = i => {
        if (done) return;
        done = true;
        resolve(inp ? (i === 0 ? inp.value.trim() : null) : buttons[i]);
        w.close();
      };
      const btns = buttons.map((b, i) => el('button', { class: 'btn', onclick: () => finish(i) }, b));
      w.body.append(el('div', { class: 'dlg' },
        el('div', { class: 'dlg-row' },
          el('div', { class: 'dlg-icon' }, icon),
          el('div', { class: 'dlg-msg' }, message, extra, inp)),
        el('div', { class: 'dlg-btns' }, btns)));
      w.node.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(0); }
        if (e.key === 'Escape') { e.preventDefault(); w.close(); }
      });
      WM.center(w);
      setTimeout(() => {
        if (inp) {
          inp.focus();
          const dot = inp.value.lastIndexOf('.');
          const slash = inp.value.lastIndexOf('/');
          inp.setSelectionRange(slash + 1, dot > slash + 1 ? dot : inp.value.length);
        } else btns[0].focus();
      });
      if (icon === '❌' || icon === '⚠️') Sound.ding();
    });
  },
  alert(message, title = 'IROS', icon = 'ℹ️') { return this.dialog({ title, message, icon }); },
  error(message, title = 'Error') { return this.dialog({ title, message, icon: '❌' }); },
  confirm(message, title = 'Confirm') {
    return this.dialog({ title, message, icon: '❓', buttons: ['Yes', 'No'] }).then(r => r === 'Yes');
  },
  prompt(message, def = '', title = 'IROS') {
    return this.dialog({ title, message, icon: '✏️', input: def, buttons: ['OK', 'Cancel'] });
  },

  notify(title, body = '', icon = '🔔') {
    const box = $('#notifications');
    const n = el('div', { class: 'toast' }, el('div', { class: 'toast-icon' }, icon), el('div', {}, el('b', {}, title), el('div', {}, body)));
    n.onclick = () => n.remove();
    box.append(n);
    Sound.pop();
    setTimeout(() => n.classList.add('out'), 4000);
    setTimeout(() => n.remove(), 4500);
  },

  tabs(names, onChange) {
    const bar = el('div', { class: 'tabs' });
    const tabs = names.map((n, i) => el('div', { class: 'tab raised' + (i ? '' : ' on'), onclick: () => select(i) }, n));
    function select(i) { tabs.forEach((t, j) => t.classList.toggle('on', i === j)); onChange(i); }
    bar.append(...tabs);
    return bar;
  },
};

function tryRun(fn) {
  try { return fn(); } catch (e) { UI.error(e.message); }
}
