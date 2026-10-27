'use strict';

// ---- Desktop shell: boot, login, desktop, taskbar, Start menu, Activities, power ----

function applyTheme() {
  document.body.dataset.theme = Settings.get('theme');
  const wp = Settings.get('wallpaper');
  $('#desktop').style.background = wp === 'custom' ? Settings.get('customColor') : (WALLPAPERS[wp] || WALLPAPERS.teal).css;
}

// ---------- Desktop icons ----------
function renderDesktop() {
  const box = $('#icons');
  box.innerHTML = '';
  const trashFull = VFS.isDir(TRASH) && VFS.list(TRASH, true).length > 0;
  const items = [
    { icon: '🖥️', label: 'My Computer', open: () => launch('files', { path: '/' }) },
    { icon: '🏠', label: 'Home', open: () => launch('files', { path: HOME }) },
    { icon: '💻', label: 'Terminal', open: () => launch('terminal') },
    { icon: '🛍️', label: 'Software Center', open: () => launch('software') },
    { icon: trashFull ? '🗑️' : '🗑', label: trashFull ? 'Trash (full)' : 'Trash', open: () => launch('files', { path: TRASH }),
      menu: [{ label: 'Open', icon: '📂', action: () => launch('files', { path: TRASH }) }, { label: 'Empty Trash', icon: '🧹', action: emptyTrash }] },
  ];
  const desk = HOME + '/Desktop';
  if (VFS.isDir(desk)) {
    for (const n of VFS.list(desk)) {
      const p = VFS.join(desk, n), node = VFS.get(p);
      items.push({
        icon: fileIcon(n, node), label: n, open: () => openPath(p),
        menu: [
          { label: 'Open', icon: '📂', action: () => openPath(p) },
          node.type === 'file' && { label: 'Open with Text Editor', icon: '📝', action: () => launch('editor', { path: p }) },
          '-',
          { label: 'Rename...', icon: '✏️', action: () => renameItem(p) },
          { label: 'Move to Trash', icon: '🗑️', action: () => tryRun(() => VFS.trash(p)) },
          '-',
          { label: 'Properties', icon: 'ℹ️', action: () => properties(p) },
        ],
      });
    }
  }
  for (const it of items) {
    const d = el('div', { class: 'dicon', title: it.label }, el('div', { class: 'ic' }, it.icon), el('div', { class: 'lb' }, it.label));
    d.onclick = e => { e.stopPropagation(); box.querySelectorAll('.dicon.sel').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); };
    d.ondblclick = it.open;
    d.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation(); d.onclick(e);
      UI.menu(e.clientX, e.clientY, it.menu || [{ label: 'Open', icon: '📂', action: it.open }]);
    };
    box.append(d);
  }
}

function desktopMenu(e) {
  if (e.target.closest('.dicon')) return;
  e.preventDefault();
  const desk = HOME + '/Desktop';
  UI.menu(e.clientX, e.clientY, [
    { label: 'New', icon: '✨', items: [
      { label: 'Folder', icon: '📁', action: () => newFolderIn(desk) },
      { label: 'Text Document', icon: '📄', action: () => newFileIn(desk) },
    ] },
    '-',
    { label: 'Open Terminal Here', icon: '💻', action: () => launch('terminal', { cwd: desk }) },
    { label: 'Open Desktop Folder', icon: '📂', action: () => launch('files', { path: desk }) },
    { label: 'Refresh', icon: '🔄', action: renderDesktop },
    '-',
    { label: 'Change Background...', icon: '🖼️', action: () => launch('settings', { page: 'background' }) },
    { label: 'Properties', icon: '⚙️', action: () => launch('settings', { page: 'appearance' }) },
  ]);
}

// ---------- Start menu ----------
function openStartMenu() {
  const btn = $('#start-btn');
  if ($('.start-menu')) { UI.closeMenus(); return; }
  const apps = installedApps();
  const cats = [...new Set(apps.map(a => a.category))].sort();
  const docs = VFS.isDir(HOME + '/Documents') ? VFS.list(HOME + '/Documents') : [];
  const items = [
    { icon: '📦', label: 'Programs', items: [
      ...cats.map(cat => ({ icon: '📂', label: cat, items: apps.filter(a => a.category === cat).map(a => ({ icon: a.icon, label: a.name, action: () => launch(a.id) })) })),
      '-',
      { icon: '🛍️', label: 'Get more software...', action: () => launch('software') },
    ] },
    { icon: '📄', label: 'Documents', items: [
      { icon: '📂', label: 'Documents folder', action: () => launch('files', { path: HOME + '/Documents' }) },
      docs.length ? '-' : null,
      ...docs.map(n => { const p = HOME + '/Documents/' + n; return { icon: fileIcon(n, VFS.get(p)), label: n, action: () => openPath(p) }; }),
    ] },
    { icon: '⚙️', label: 'Settings', items: [
      { icon: '🎨', label: 'Appearance', action: () => launch('settings', { page: 'appearance' }) },
      { icon: '🖼️', label: 'Desktop Background', action: () => launch('settings', { page: 'background' }) },
      { icon: '👤', label: 'Users', action: () => launch('settings', { page: 'users' }) },
      { icon: '🛍️', label: 'Software Center', action: () => launch('software') },
    ] },
    { icon: '🔍', label: 'Find (Activities)...', hint: 'Ctrl+Space', action: openDash },
    { icon: '❓', label: 'Help', action: () => launch('help') },
    { icon: '🏃', label: 'Run...', action: runDialog },
    '-',
    { icon: '🔑', label: `Log Off ${Settings.get('username')}...`, action: () => System.shutdown('logoff') },
    { icon: '⏻', label: 'Shut Down...', action: shutdownDialog },
  ];
  const m = UI.menu(0, 0, items, { cls: 'start-menu', banner: 'IROS 98.04' });
  const r = btn.getBoundingClientRect();
  m.style.left = '2px';
  m.style.top = (r.top - m.offsetHeight - 2) + 'px';
  btn.classList.add('pressed');
}

async function runDialog() {
  const v = await UI.dialog({
    title: 'Run', icon: '🏃', input: '', buttons: ['OK', 'Cancel'], width: 380,
    message: 'Type the name of a program, folder, document or command, and IROS will open it for you.',
  });
  if (!v) return;
  const word = v.split(/\s+/)[0];
  const app = APP_ALIASES[word] || (APPS[word] && word);
  if (app && v === word) return launch(app);
  const p = VFS.norm(v);
  if (VFS.exists(p)) return openPath(p);
  launch('terminal', { run: v });
}

function shutdownDialog() {
  const w = WM.open({ title: 'Shut Down IROS', icon: '⏻', width: 360, height: 'auto', resizable: false, noMin: true, noTask: true });
  let choice = 'off';
  const opts = [['off', 'Shut down'], ['restart', 'Restart'], ['logoff', `Log off ${Settings.get('username')}`]];
  w.body.append(el('div', { class: 'dlg' },
    el('div', { class: 'dlg-row' }, el('div', { class: 'dlg-icon' }, '🖥️'),
      el('div', { class: 'dlg-msg' }, 'What do you want the computer to do?',
        el('div', {}, opts.map(([id, lb]) => el('label', { class: 'radio' },
          el('input', { type: 'radio', name: 'sd' + w.id, checked: id === choice, onchange: () => (choice = id) }), lb))))),
    el('div', { class: 'dlg-btns' },
      el('button', { class: 'btn', onclick: () => { w.close(); System.shutdown(choice); } }, 'OK'),
      el('button', { class: 'btn', onclick: () => w.close() }, 'Cancel'))));
  WM.center(w);
}

// ---------- Activities overview (Ubuntu-style) ----------
let dashSel = 0;
function openDash() {
  const d = $('#dash');
  if (!d.hidden) return closeDash();
  UI.closeMenus();
  d.hidden = false;
  const s = $('#dash-search');
  s.value = '';
  renderDash();
  setTimeout(() => s.focus());
}
function closeDash() { $('#dash').hidden = true; }

function renderDash() {
  const q = $('#dash-search').value.trim().toLowerCase();
  const wsBox = $('#dash-ws'), grid = $('#dash-grid'), files = $('#dash-files');
  wsBox.innerHTML = '';
  for (let i = 0; i < WM.WS_COUNT; i++) {
    const wins = WM.list().filter(w => w.ws === i && !w.noTask);
    wsBox.append(el('div', { class: 'wsbox' + (i === WM.workspace ? ' on' : ''), onclick: () => { WM.setWorkspace(i); closeDash(); } },
      el('div', { class: 'ws-icons' }, wins.length ? wins.slice(0, 6).map(w => el('span', { title: w.title }, w.icon)) : el('span', { class: 'ws-empty' }, 'empty')),
      el('div', { class: 'ws-name' }, `Workspace ${i + 1}`)));
  }
  const apps = installedApps().filter(a => !q || a.name.toLowerCase().includes(q) || a.id.includes(q));
  const results = [...apps.map(a => ({ icon: a.icon, label: a.name, run: () => launch(a.id) }))];
  if (q) {
    const extras = Packages.catalog.filter(p => p.kind === 'app' && !Packages.isInstalled(p.id) && (p.name.toLowerCase().includes(q) || p.id.includes(q)));
    results.push(...extras.map(p => ({ icon: p.icon, label: p.name, sub: 'Install', run: () => launch('software', { focus: p.id }) })));
    if (/^[\w.\-/ ~|>]+$/.test(q)) results.push({ icon: '💻', label: `Run "${q}"`, sub: 'in Terminal', run: () => launch('terminal', { run: $('#dash-search').value.trim() }) });
  }
  dashSel = Math.min(dashSel, Math.max(0, results.length - 1));
  grid.innerHTML = '';
  results.forEach((r, i) => grid.append(el('div', { class: 'dash-app' + (i === dashSel && q ? ' hl' : ''), onclick: () => { closeDash(); r.run(); } },
    el('div', { class: 'ic' }, r.icon), el('div', {}, r.label), r.sub ? el('div', { class: 'sub' }, r.sub) : null)));
  grid._results = results;
  files.innerHTML = '';
  if (q.length >= 2) {
    const hits = [];
    VFS.walk('/', (p, n) => { if (hits.length < 8 && p !== '/' && basename(p).toLowerCase().includes(q) && !p.includes('/.')) hits.push([p, n]); });
    if (hits.length) {
      files.append(el('div', { class: 'dash-h' }, 'Files'));
      for (const [p, n] of hits) files.append(el('div', { class: 'dash-file', onclick: () => { closeDash(); openPath(p); } }, el('span', {}, fileIcon(basename(p), n)), el('b', {}, basename(p)), el('span', { class: 'sub' }, prettyPath(dirname(p)))));
    }
  }
}

// ---------- Tray ----------
function updateClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#clock').title = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function toggleCalendar() {
  if ($('.calendar')) return UI.closeMenus();
  UI.closeMenus();
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const cells = [...'SMTWTFS'].map(c => el('b', {}, c));
  for (let i = 0; i < first; i++) cells.push(el('span'));
  for (let i = 1; i <= days; i++) cells.push(el('span', { class: i === d.getDate() ? 'today' : '' }, i));
  const cal = el('div', { class: 'calendar raised' },
    el('div', { class: 'cal-title' }, d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })),
    el('div', { class: 'cal-time' }, d.toLocaleTimeString()),
    el('div', { class: 'cal-grid sunken' }, cells));
  document.body.append(cal);
}

// ---------- Power / session ----------
const System = {
  skip: false,
  wait(ms) { return this.skip ? Promise.resolve() : sleep(ms); },

  async boot() {
    this.skip = false;
    const skipper = () => (this.skip = true);
    addEventListener('keydown', skipper);
    addEventListener('pointerdown', skipper);
    const boot = $('#boot');
    boot.hidden = false;
    boot.innerHTML = '';
    const line = (html = '') => { const s = el('div', { html }); boot.append(s); return s; };
    line('<span class="bios-logo">IR</span><b>IRBIOS (C) 2026 IR Systems, Inc.</b>');
    line('Version 4.51 PG &nbsp; <span class="dim">(press any key or click to skip)</span>');
    line();
    line(`CPU: Virtual x86_64 Processor, ${navigator.hardwareConcurrency || 4} cores @ 2.98 GHz`);
    const mem = line('Memory Test: 0K');
    for (let k = 0; k <= 65536; k += 4096) { mem.textContent = `Memory Test: ${k}K`; await this.wait(25); }
    mem.textContent += ' OK';
    line();
    for (const t of ['Detecting IDE drives ...', '  Primary Master:   IRDISK-98 VFS (localStorage)', '  Primary Slave:    None', '  Secondary Master: CD-ROM IR-52X', '', 'Booting from Hard Disk...', '', 'GRUB loading.', 'Loading Linux 6.8.0-iros ...', 'Loading initial ramdisk ...']) {
      line(escapeHTML(t) || '&nbsp;');
      await this.wait(70);
    }
    boot.innerHTML = '';
    const svc = ['Started Journal Service', 'Mounted /home (VFS)', 'Started Network Manager', 'Started Sound Service', 'Started Package Manager (apt)', 'Started Window Manager', 'Reached target Graphical Interface'];
    line(`[    0.000000] Linux version 6.8.0-iros (gcc 13.2.0) #98-IROS SMP`);
    line(`[    0.012345] Command line: BOOT_IMAGE=/vmlinuz-6.8.0-iros root=/dev/vfs0 ro quiet splash`);
    for (const s of svc) { await this.wait(110); line(`[<span class="ok">  OK  </span>] ${s}.`); }
    await this.wait(300);
    boot.hidden = true;

    const splash = $('#splash');
    splash.hidden = false;
    await this.wait(2200);
    splash.hidden = true;
    removeEventListener('keydown', skipper);
    removeEventListener('pointerdown', skipper);
    this.login();
  },

  login() {
    const box = $('#login');
    box.hidden = false;
    box.innerHTML = '';
    const user = el('input', { class: 'field', value: Settings.get('username'), spellcheck: 'false' });
    const pass = el('input', { class: 'field', type: 'password', placeholder: '(any password)' });
    const go = () => {
      const u = user.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'user';
      if (u !== Settings.get('username')) Settings.set('username', u);
      box.hidden = true;
      this.start();
    };
    const win = el('div', { class: 'window raised active login-win' },
      el('div', { class: 'titlebar' }, el('span', { class: 'ticon' }, '🔑'), el('span', { class: 'ttext' }, 'Welcome to IROS'), el('div', { class: 'tbtns' }, el('button', { class: 'tbtn', title: 'Help', onclick: () => UI.alert('Enter any user name. Any password will do.', 'Log On', '❓') }, '?'))),
      el('div', { class: 'wbody' },
        el('div', { class: 'login-banner' }, el('span', { class: 'logo-mark' }, 'IR'), el('div', {}, el('b', {}, 'IROS'), el('span', {}, ` ${VERSION}`))),
        el('div', { class: 'dlg' },
          el('div', { class: 'dlg-row' }, el('div', { class: 'dlg-icon' }, '🔑'),
            el('div', { class: 'dlg-msg' }, 'Type a user name and password to log on to IROS.',
              el('label', { class: 'form-row' }, el('span', {}, 'User name:'), user),
              el('label', { class: 'form-row' }, el('span', {}, 'Password:'), pass))),
          el('div', { class: 'dlg-btns' },
            el('button', { class: 'btn', onclick: go }, 'OK'),
            el('button', { class: 'btn', onclick: () => this.shutdown('off') }, 'Shut Down')))));
    win.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    box.append(win);
    setTimeout(() => pass.focus());
  },

  start() {
    applyTheme();
    renderDesktop();
    updateClock();
    if (WM.workspace) WM.setWorkspace(0);
    Sound.startup();
    setTimeout(() => UI.notify(`Welcome, ${Settings.get('username')}!`, 'Ctrl+Space: Activities  •  Ctrl+Alt+T: Terminal', '👋'), 600);
  },

  async shutdown(mode) {
    UI.closeMenus();
    closeDash();
    WM.closeAll();
    if (mode === 'logoff') { Sound.shutdown(); this.login(); return; }
    const p = $('#power');
    p.hidden = false;
    p.className = 'power-wait';
    p.innerHTML = '';
    p.append(el('div', { class: 'splash-inner' }, el('div', { class: 'splash-logo' }, el('span', { class: 'logo-mark big' }, 'IR'), 'IROS'),
      el('div', { class: 'splash-sub' }, mode === 'restart' ? 'IROS is restarting…' : 'Please wait while IROS shuts down…')));
    Sound.shutdown();
    await sleep(2200);
    if (mode === 'restart') { p.hidden = true; this.boot(); return; }
    p.className = 'power-off';
    p.innerHTML = '';
    p.append(el('div', {}, 'It is now safe to turn off your computer.'), el('small', {}, 'Click anywhere to power on'));
    p.onclick = () => { p.onclick = null; p.hidden = true; this.boot(); };
  },
};

// ---------- Global wiring ----------
function initShell() {
  $('#start-btn').addEventListener('click', e => { e.stopPropagation(); openStartMenu(); });
  document.querySelectorAll('.qbtn').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.app) launch(b.dataset.app);
    else if (b.dataset.act === 'dash') openDash();
    else if (b.dataset.act === 'desktop') WM.showDesktop();
  }));
  document.querySelectorAll('.ws-switch button').forEach((b, i) => b.addEventListener('click', () => WM.setWorkspace(i)));
  $('#clock').addEventListener('click', e => { e.stopPropagation(); toggleCalendar(); });
  $('#vol').addEventListener('click', () => { Settings.set('sound', !Settings.get('sound')); UI.notify(Settings.get('sound') ? 'Sound on' : 'Sound muted', '', Settings.get('sound') ? '🔊' : '🔇'); });
  $('#net').addEventListener('click', () => UI.notify('Wired connection 1', 'Connected to IROS-Net — 1000 Mb/s', '🌐'));
  $('#desktop').addEventListener('contextmenu', desktopMenu);
  $('#desktop').addEventListener('click', () => document.querySelectorAll('.dicon.sel').forEach(x => x.classList.remove('sel')));

  const dash = $('#dash'), ds = $('#dash-search');
  ds.addEventListener('input', () => { dashSel = 0; renderDash(); });
  ds.addEventListener('keydown', e => {
    const results = $('#dash-grid')._results || [];
    if (e.key === 'Enter' && results[dashSel]) { closeDash(); results[dashSel].run(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { dashSel = Math.min(results.length - 1, dashSel + 1); renderDash(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { dashSel = Math.max(0, dashSel - 1); renderDash(); e.preventDefault(); }
  });
  dash.addEventListener('click', e => { if (e.target === dash || e.target.id === 'dash-grid') closeDash(); });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.ctx-menu, #start-btn, .menubar, .calendar, #clock')) UI.closeMenus();
  });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

  let superAlone = false;
  document.addEventListener('keydown', e => {
    if (!$('#login').hidden || !$('#boot').hidden) return;
    superAlone = e.key === 'Meta' || e.key === 'OS';
    const k = e.key.toLowerCase();
    if (e.ctrlKey && e.altKey && k === 't') { e.preventDefault(); launch('terminal'); }
    else if (e.ctrlKey && (e.code === 'Space' || k === ' ')) { e.preventDefault(); openDash(); }
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); WM.setWorkspace(WM.workspace + 1); }
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); WM.setWorkspace(WM.workspace - 1); }
    else if (e.altKey && (e.key === 'F4' || e.code === 'KeyW')) { e.preventDefault(); WM.active()?.close(); }
    else if (e.key === 'Escape') { UI.closeMenus(); closeDash(); }
  });
  document.addEventListener('keyup', e => {
    if ((e.key === 'Meta' || e.key === 'OS') && superAlone) openDash();
    superAlone = false;
  });

  Bus.on('fs', renderDesktop);
  Bus.on('settings', k => { if (['theme', 'wallpaper', 'customColor'].includes(k)) applyTheme(); });
  Bus.on('workspace', n => { if (!$('#login').hidden) return; UI.notify(`Workspace ${n + 1}`, '', '🗂️'); });
  Bus.on('windows', () => { if (!$('#dash').hidden) renderDash(); });
  setInterval(updateClock, 10000);
}

Settings.load();
VFS.load();
applyTheme();
initShell();
System.boot();
