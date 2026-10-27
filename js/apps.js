'use strict';

// ---- App registry, packages and desktop applications ----

const APPS = {};
function registerApp(id, def) { APPS[id] = { id, category: 'Accessories', ...def }; }

const Packages = {
  catalog: [
    { id: 'paint', name: 'IR Paint', icon: '🎨', version: '2.1.0', kb: 1840, kind: 'app', desc: 'Simple drawing program with pencil, brush, shapes, spray and flood fill.' },
    { id: 'mines', name: 'Mines', icon: '💣', version: '1.4.2', kb: 420, kind: 'app', desc: 'Logic puzzle: clear the field without setting off a mine.' },
    { id: 'sysmon', name: 'System Monitor', icon: '📊', version: '3.0.1', kb: 960, kind: 'app', desc: 'View running processes and live CPU / memory graphs.' },
    { id: 'clock', name: 'Clock', icon: '🕰️', version: '1.0.3', kb: 210, kind: 'app', desc: 'Analog clock with a stopwatch.' },
    { id: 'neofetch', name: 'neofetch', icon: '🐧', version: '7.1.0', kb: 84, kind: 'cmd', desc: 'Shows system information next to an ASCII logo in the terminal.' },
    { id: 'cowsay', name: 'cowsay', icon: '🐮', version: '3.03', kb: 19, kind: 'cmd', desc: 'A talking cow for your terminal. Try: fortune | cowsay' },
    { id: 'fortune', name: 'fortune', icon: '🥠', version: '1.99.1', kb: 45, kind: 'cmd', desc: 'Prints a random, hopefully interesting, adage.' },
    { id: 'sl', name: 'sl', icon: '🚂', version: '5.02', kb: 12, kind: 'cmd', desc: 'A steam locomotive crosses your terminal when you mistype "ls".' },
  ],
  find(id) { return this.catalog.find(p => p.id === id); },
  isInstalled(id) { return !!APPS[id]?.builtin || Settings.get('installed').includes(id); },
  install(id) {
    if (!Settings.get('installed').includes(id)) Settings.set('installed', [...Settings.get('installed'), id]);
    Bus.emit('packages');
  },
  remove(id) {
    Settings.set('installed', Settings.get('installed').filter(x => x !== id));
    for (const w of WM.list()) if (w.app === id) w.close();
    Bus.emit('packages');
  },
};

function installedApps() {
  return Object.values(APPS).filter(a => !a.hidden && Packages.isInstalled(a.id)).sort((a, b) => a.name.localeCompare(b.name));
}

function launch(id, args = {}) {
  const a = APPS[id];
  if (!a) { UI.error(`Cannot find '${id}'. Make sure you typed the name correctly.`); return; }
  if (!Packages.isInstalled(id)) {
    UI.dialog({ title: a.name, icon: '📦', message: `${a.name} is not installed.\nOpen the Software Center to install it?`, buttons: ['Open Software', 'Cancel'] })
      .then(r => { if (r === 'Open Software') launch('software', { focus: id }); });
    return;
  }
  return a.launch(args);
}

const isImage = (name, node) => /\.(png|jpe?g|gif|bmp)$/i.test(name) || (node?.type === 'file' && node.content.startsWith('data:image'));

function fileIcon(name, node) {
  if (node?.type === 'dir') return name === 'Trash' ? '🗑️' : '📁';
  if (isImage(name, node)) return '🖼️';
  if (/\.sh$/.test(name)) return '⚙️';
  if (/\.md$/.test(name)) return '📝';
  return '📄';
}

function openPath(path) {
  const n = VFS.get(path);
  if (!n) return UI.error(`'${path}' could not be found.`);
  if (n.type === 'dir') return launch('files', { path });
  if (isImage(path, n)) return launch(Packages.isInstalled('paint') ? 'paint' : 'viewer', { path });
  if (/\.sh$/.test(path)) return launch('terminal', { cwd: dirname(path), run: `bash ${basename(path)}` });
  return launch('editor', { path });
}

async function newFolderIn(dir) {
  const n = await UI.prompt('Folder name:', VFS.uniqueName(dir, 'New Folder'), 'New Folder');
  if (n) tryRun(() => VFS.mkdir(VFS.join(dir, n)));
}
async function newFileIn(dir) {
  const n = await UI.prompt('File name:', VFS.uniqueName(dir, 'New Text Document.txt'), 'New File');
  if (n) tryRun(() => VFS.create(VFS.join(dir, n)));
}
async function renameItem(p) {
  const n = await UI.prompt('New name:', basename(p), 'Rename');
  if (n && n !== basename(p)) {
    if (n.includes('/')) return UI.error('A file name cannot contain "/".');
    if (VFS.exists(VFS.join(dirname(p), n))) return UI.error(`'${n}' already exists.`);
    tryRun(() => VFS.move(p, VFS.join(dirname(p), n)));
  }
}
function properties(p) {
  const n = VFS.get(p);
  if (!n) return;
  let count = 0;
  if (n.type === 'dir') VFS.walk(p, () => count++);
  UI.alert([
    `Name:      ${basename(p)}`,
    `Type:      ${n.type === 'dir' ? 'Folder' : 'File'}`,
    `Location:  ${prettyPath(dirname(p))}`,
    `Size:      ${fmtSize(n.type === 'dir' ? VFS.size(p) : n.content.length)}`,
    n.type === 'dir' ? `Contains:  ${count - 1} item(s)` : null,
    `Modified:  ${new Date(n.mtime).toLocaleString()}`,
  ].filter(Boolean).join('\n'), `${basename(p)} Properties`, fileIcon(basename(p), n));
}
async function emptyTrash() {
  const items = VFS.isDir(TRASH) ? VFS.list(TRASH, true) : [];
  if (!items.length) return UI.alert('The Trash is already empty.', 'Trash', '🗑️');
  if (!await UI.confirm(`Permanently delete all ${items.length} item(s) in the Trash?`, 'Empty Trash')) return;
  for (const n of items) VFS.remove(VFS.join(TRASH, n), true);
}

// ---------- File Manager ----------
registerApp('files', {
  name: 'File Manager', icon: '📁', builtin: true, category: 'System',
  launch({ path = HOME } = {}) {
    const w = WM.open({ title: 'File Manager', icon: '📁', app: 'files', width: 660, height: 430 });
    let cwd = VFS.isDir(path) ? VFS.norm(path) : HOME, sel = null;
    const back = [];
    const addr = el('input', { class: 'field', spellcheck: 'false' });
    addr.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const p = VFS.norm(addr.value, cwd);
      if (VFS.isDir(p)) go(p); else if (VFS.exists(p)) openPath(p); else UI.error(`IROS cannot find '${addr.value}'.`);
    });
    const tb = el('div', { class: 'toolbar' },
      el('button', { class: 'tb', title: 'Back', onclick: () => back.length && go(back.pop(), false) }, '⬅️ Back'),
      el('button', { class: 'tb', title: 'Up one level', onclick: () => go(dirname(cwd)) }, '⬆️ Up'),
      el('span', { class: 'tb-sep' }),
      el('button', { class: 'tb', title: 'New Folder', onclick: () => newFolderIn(cwd) }, '📁 New Folder'),
      el('button', { class: 'tb', title: 'New File', onclick: () => newFileIn(cwd) }, '📄 New File'),
      el('button', { class: 'tb', title: 'Open Terminal Here', onclick: () => launch('terminal', { cwd }) }, '💻 Terminal'));
    const addrRow = el('div', { class: 'toolbar' }, el('span', { class: 'addr-label' }, 'Address'), addr);
    const side = el('div', { class: 'fm-side sunken' });
    const main = el('div', { class: 'fm-main sunken', tabindex: '0' });
    const status = el('div', { class: 'statusbar' }, el('div'), el('div'));
    w.body.append(tb, addrRow, el('div', { class: 'fm' }, side, main), status);

    const places = [['🏠', 'Home', HOME], ['🖥️', 'Desktop', HOME + '/Desktop'], ['📄', 'Documents', HOME + '/Documents'],
      ['🖼️', 'Pictures', HOME + '/Pictures'], ['🎵', 'Music', HOME + '/Music'], ['⬇️', 'Downloads', HOME + '/Downloads'],
      ['💽', 'File System', '/'], ['🗑️', 'Trash', TRASH]];

    function go(p, push = true) {
      if (!VFS.isDir(p)) return;
      if (push && p !== cwd) back.push(cwd);
      cwd = p; sel = null;
      render();
    }
    function render() {
      if (!VFS.isDir(cwd)) cwd = HOME;
      const name = cwd === TRASH ? 'Trash' : cwd === '/' ? 'File System' : cwd === HOME ? 'Home' : basename(cwd);
      w.setTitle(`${name} - File Manager`);
      w.node.querySelector('.ticon').textContent = cwd === TRASH ? '🗑️' : '📁';
      addr.value = cwd === TRASH ? 'trash:///' : prettyPath(cwd);
      side.innerHTML = '';
      for (const [ic, lb, p] of places) side.append(el('div', { class: p === cwd ? 'on' : '', onclick: () => go(p) }, el('span', {}, ic), lb));
      main.innerHTML = '';
      const names = VFS.list(cwd, cwd === TRASH).sort((a, b) => (VFS.isDir(VFS.join(cwd, b)) - VFS.isDir(VFS.join(cwd, a))));
      if (!names.length) main.append(el('div', { class: 'fm-empty' }, cwd === TRASH ? 'Trash is empty' : 'This folder is empty'));
      for (const n of names) {
        const p = VFS.join(cwd, n), node = VFS.get(p);
        const it = el('div', { class: 'fitem' + (sel === n ? ' sel' : '') }, el('div', { class: 'ic' }, fileIcon(n, node)), el('div', { class: 'lb' }, n));
        it.onclick = e => {
          e.stopPropagation();
          sel = n;
          main.querySelectorAll('.fitem.sel').forEach(x => x.classList.remove('sel'));
          it.classList.add('sel');
          status.firstChild.textContent = `${n} — ${node.type === 'dir' ? 'Folder' : fmtSize(node.content.length)}${node.orig ? ' — from ' + prettyPath(dirname(node.orig)) : ''}`;
        };
        it.ondblclick = () => (cwd === TRASH ? null : node.type === 'dir' ? go(p) : openPath(p));
        it.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); it.onclick(e); UI.menu(e.clientX, e.clientY, itemMenu(p, node)); };
        main.append(it);
      }
      status.firstChild.textContent = `${names.length} object(s)`;
      status.lastChild.textContent = fmtSize(names.reduce((s, n) => s + VFS.size(VFS.join(cwd, n)), 0));
    }
    function itemMenu(p, node) {
      if (cwd === TRASH) return [
        { label: 'Restore', icon: '↩️', action: () => tryRun(() => VFS.restore(p)) },
        { label: 'Delete Permanently', icon: '❌', action: async () => { if (await UI.confirm(`Permanently delete '${basename(p)}'?`, 'Delete')) tryRun(() => VFS.remove(p, true)); } },
      ];
      return [
        { label: 'Open', icon: '📂', action: () => (node.type === 'dir' ? go(p) : openPath(p)) },
        node.type === 'file' && { label: 'Open with Text Editor', icon: '📝', action: () => launch('editor', { path: p }) },
        node.type === 'dir' && { label: 'Open in Terminal', icon: '💻', action: () => launch('terminal', { cwd: p }) },
        '-',
        { label: 'Duplicate', icon: '📑', action: () => tryRun(() => VFS.copy(p, VFS.join(cwd, VFS.uniqueName(cwd, basename(p))))) },
        { label: 'Rename...', icon: '✏️', action: () => renameItem(p) },
        { label: 'Move to Trash', icon: '🗑️', hint: 'Del', action: () => tryRun(() => VFS.trash(p)) },
        '-',
        { label: 'Properties', icon: 'ℹ️', action: () => properties(p) },
      ];
    }
    main.oncontextmenu = e => {
      e.preventDefault();
      UI.menu(e.clientX, e.clientY, cwd === TRASH
        ? [{ label: 'Empty Trash', icon: '🧹', action: emptyTrash }]
        : [{ label: 'New Folder', icon: '📁', action: () => newFolderIn(cwd) },
          { label: 'New Text File', icon: '📄', action: () => newFileIn(cwd) },
          '-',
          { label: 'Open Terminal Here', icon: '💻', action: () => launch('terminal', { cwd }) },
          { label: 'Refresh', icon: '🔄', action: render },
          { label: 'Properties', icon: 'ℹ️', action: () => properties(cwd) }]);
    };
    main.onclick = () => { sel = null; main.querySelectorAll('.fitem.sel').forEach(x => x.classList.remove('sel')); };
    main.addEventListener('keydown', e => {
      if (e.key === 'Backspace') go(dirname(cwd));
      if (!sel) return;
      const p = VFS.join(cwd, sel);
      if (e.key === 'Delete') tryRun(() => (cwd === TRASH ? VFS.remove(p, true) : VFS.trash(p)));
      if (e.key === 'Enter') VFS.isDir(p) ? go(p) : openPath(p);
      if (e.key === 'F2') renameItem(p);
    });
    const off = Bus.on('fs', render);
    w.onClose = off;
    render();
    return w;
  },
});

// ---------- Text Editor ----------
registerApp('editor', {
  name: 'Text Editor', icon: '📝', builtin: true,
  launch({ path } = {}) {
    const w = WM.open({ title: 'Text Editor', icon: '📝', app: 'editor', width: 580, height: 420 });
    let file = null, dirty = false, wrap = true;
    const ta = el('textarea', { class: 'editor sunken', spellcheck: 'false' });
    const status = el('div', { class: 'statusbar' }, el('div'), el('div'));
    const mb = UI.menubar([
      { label: 'File', items: () => [
        { label: 'New', hint: 'Ctrl+N', action: newDoc },
        { label: 'Open...', hint: 'Ctrl+O', action: openDoc },
        { label: 'Save', hint: 'Ctrl+S', action: save },
        { label: 'Save As...', action: saveAs },
        '-',
        { label: 'Exit', action: () => w.close() },
      ] },
      { label: 'Edit', items: () => [
        { label: 'Select All', hint: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } },
        { label: 'Time/Date', hint: 'F5', action: insertDate },
      ] },
      { label: 'Format', items: () => [{ label: 'Word Wrap', checked: wrap, action: toggleWrap }] },
      { label: 'Help', items: [{ label: 'About Text Editor', action: () => UI.alert(`Text Editor 1.0\nIROS ${VERSION}`, 'About Text Editor', '📝') }] },
    ]);
    w.body.append(mb, ta, status);

    function title() {
      w.setTitle(`${dirty ? '*' : ''}${file ? basename(file) : 'Untitled'} - Text Editor`);
      status.firstChild.textContent = file ? prettyPath(file) : 'New document';
    }
    function pos() {
      const v = ta.value.slice(0, ta.selectionStart);
      status.lastChild.textContent = `Ln ${v.split('\n').length}, Col ${v.length - v.lastIndexOf('\n')}`;
    }
    function insert(text) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    function insertDate() { insert(new Date().toLocaleString()); }
    function toggleWrap() { wrap = !wrap; ta.wrap = wrap ? 'soft' : 'off'; }
    function load(p) {
      try { ta.value = VFS.read(p); file = VFS.norm(p); dirty = false; title(); pos(); }
      catch (e) { UI.error(`${p}: ${e.message}`, 'Text Editor'); }
    }
    async function confirmDiscard() {
      if (!dirty) return true;
      const r = await UI.dialog({ title: 'Text Editor', icon: '⚠️', message: `The text in ${file ? basename(file) : 'Untitled'} has changed.\n\nDo you want to save the changes?`, buttons: ['Yes', 'No', 'Cancel'] });
      if (r === 'Yes') return save();
      return r === 'No';
    }
    async function newDoc() { if (await confirmDiscard()) { ta.value = ''; file = null; dirty = false; title(); } }
    async function openDoc() {
      if (!await confirmDiscard()) return;
      const p = await UI.prompt('Path of the file to open:', (file ? dirname(file) : HOME + '/Documents') + '/', 'Open');
      if (p) load(VFS.norm(p));
    }
    async function save() {
      if (!file) return saveAs();
      try { VFS.write(file, ta.value); dirty = false; title(); return true; }
      catch (e) { UI.error(e.message, 'Text Editor'); return false; }
    }
    async function saveAs() {
      const p = await UI.prompt('Save as:', file || HOME + '/Documents/untitled.txt', 'Save As');
      if (!p) return false;
      file = VFS.norm(p);
      return save();
    }
    ta.addEventListener('input', () => { if (!dirty) { dirty = true; title(); } pos(); });
    ta.addEventListener('keyup', pos);
    ta.addEventListener('click', pos);
    ta.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 's') { e.preventDefault(); save(); }
      else if (mod && k === 'o') { e.preventDefault(); openDoc(); }
      else if (mod && k === 'n') { e.preventDefault(); newDoc(); }
      else if (e.key === 'F5') { e.preventDefault(); insertDate(); }
      else if (e.key === 'Tab') { e.preventDefault(); insert('    '); }
    });
    w.onClose = () => {
      if (!dirty) return;
      confirmDiscard().then(ok => { if (ok) { dirty = false; w.close(); } });
      return false;
    };
    if (path) load(path); else title();
    pos();
    setTimeout(() => ta.focus());
    return w;
  },
});

// ---------- Calculator ----------
registerApp('calc', {
  name: 'Calculator', icon: '🧮', builtin: true,
  launch() {
    const w = WM.open({ title: 'Calculator', icon: '🧮', app: 'calc', width: 260, height: 'auto', resizable: false });
    let cur = '0', acc = null, op = null, fresh = true, mem = 0;
    const disp = el('div', { class: 'calc-display sunken' }, '0');
    const memEl = el('div', { class: 'calc-mem sunken' }, '');
    const fmt = n => (Number.isFinite(n) ? String(+n.toPrecision(12)) : 'Error');
    const val = () => parseFloat(cur) || 0;
    const compute = (a, b, o) => ({ '+': a + b, '−': a - b, '×': a * b, '÷': b === 0 ? NaN : a / b })[o];
    function press(k) {
      if (cur === 'Error' && k !== 'C') { cur = '0'; acc = null; op = null; fresh = true; }
      if (/^[0-9]$/.test(k)) { cur = fresh || cur === '0' ? k : cur.length < 16 ? cur + k : cur; fresh = false; }
      else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.'; }
      else if ('+−×÷'.includes(k)) {
        if (op && !fresh) cur = fmt(compute(acc, val(), op));
        acc = val(); op = k; fresh = true;
      }
      else if (k === '=') { if (op) { cur = fmt(compute(acc, val(), op)); op = null; acc = null; fresh = true; } }
      else if (k === 'C') { cur = '0'; acc = null; op = null; fresh = true; }
      else if (k === 'CE') { cur = '0'; fresh = true; }
      else if (k === '←') { if (!fresh) cur = cur.length > 1 ? cur.slice(0, -1) : '0'; }
      else if (k === '±') { cur = cur.startsWith('-') ? cur.slice(1) : cur === '0' ? cur : '-' + cur; }
      else if (k === '√') { cur = fmt(Math.sqrt(val())); fresh = true; }
      else if (k === '%') { cur = fmt(acc != null ? acc * val() / 100 : val() / 100); fresh = true; }
      else if (k === '1/x') { cur = fmt(1 / val()); fresh = true; }
      else if (k === 'MC') mem = 0;
      else if (k === 'MR') { cur = fmt(mem); fresh = true; }
      else if (k === 'M+') { mem += val(); fresh = true; }
      disp.textContent = cur;
      memEl.textContent = mem ? 'M' : '';
    }
    const rows = [['MC', '←', 'CE', 'C', '±'], ['MR', '7', '8', '9', '÷'], ['M+', '4', '5', '6', '×'], ['√', '1', '2', '3', '−'], ['%', '0', '.', '1/x', '+'], ['=']];
    const grid = el('div', { class: 'calc-grid' });
    for (const r of rows) for (const k of r) {
      grid.append(el('button', {
        class: 'btn' + ('+−×÷='.includes(k) || ['C', 'CE', '←'].includes(k) ? ' op' : '') + (/^M/.test(k) ? ' mem' : '') + (k === '=' ? ' eq' : ''),
        onclick: () => press(k),
      }, k));
    }
    w.body.append(el('div', { class: 'calc' }, el('div', { class: 'calc-top' }, memEl, disp), grid));
    w.node.addEventListener('keydown', e => {
      const map = { '-': '−', '*': '×', '/': '÷', Enter: '=', '=': '=', Backspace: '←', Escape: 'C', Delete: 'CE' };
      const k = map[e.key] || e.key;
      if (/^[0-9.+]$/.test(k) || '−×÷=←CCE'.includes(k) && k.length) { e.preventDefault(); press(k); }
    });
    WM.center(w);
    w.node.focus();
    return w;
  },
});

// ---------- Paint ----------
registerApp('paint', {
  name: 'IR Paint', icon: '🎨', category: 'Graphics',
  launch({ path } = {}) {
    const w = WM.open({ title: 'IR Paint', icon: '🎨', app: 'paint', width: 700, height: 500 });
    const cv = el('canvas', { width: 600, height: 380 });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let tool = 'pencil', fg = '#000000', bg = '#ffffff', size = 3, file = null, dirty = false;
    let drawing = false, start = null, last = null, snap = null, btn = 0;
    const clear = () => { ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height); };
    clear();

    const TOOLS = [['pencil', '✏️', 'Pencil'], ['brush', '🖌️', 'Brush'], ['eraser', '🧽', 'Eraser'], ['fill', '🪣', 'Fill'],
      ['spray', '💨', 'Airbrush'], ['picker', '💧', 'Pick color'], ['line', '╱', 'Line'], ['rect', '▭', 'Rectangle'],
      ['ellipse', '◯', 'Ellipse'], ['text', 'A', 'Text']];
    const toolBtns = TOOLS.map(([id, ic, tip]) => el('button', { class: 'btn' + (id === tool ? ' pressed' : ''), title: tip, onclick: () => { tool = id; toolBtns.forEach((b, i) => b.classList.toggle('pressed', TOOLS[i][0] === id)); } }, ic));
    const sizeSel = el('select', { class: 'field', title: 'Size', onchange: e => (size = +e.target.value) }, [1, 3, 6, 10, 16, 24].map(s => el('option', { value: s, selected: s === size }, s + ' px')));
    const PALETTE = ['#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
      '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#e95420'];
    const fgBox = el('div', { class: 'pal-fg' }), bgBox = el('div', { class: 'pal-bg' });
    const updateColors = () => { fgBox.style.background = fg; bgBox.style.background = bg; };
    const custom = el('input', { type: 'color', title: 'Custom color', oninput: e => { fg = e.target.value; updateColors(); } });
    const pal = el('div', { class: 'pal-grid' }, PALETTE.map(c => {
      const d = el('div', { style: { background: c }, title: `${c} (left: foreground, right: background)` });
      d.onpointerdown = e => { if (e.button === 2) bg = c; else fg = c; updateColors(); };
      d.oncontextmenu = e => e.preventDefault();
      return d;
    }));
    updateColors();
    const status = el('div', { class: 'statusbar' }, el('div'), el('div'));
    const mb = UI.menubar([
      { label: 'File', items: () => [
        { label: 'New', action: async () => { if (!dirty || await UI.confirm('Discard the current picture?', 'IR Paint')) { clear(); file = null; dirty = false; title(); } } },
        { label: 'Open...', action: async () => { const p = await UI.prompt('Open image:', HOME + '/Pictures/', 'Open'); if (p) load(VFS.norm(p)); } },
        { label: 'Save', hint: 'Ctrl+S', action: save },
        { label: 'Save As...', action: saveAs },
        '-',
        { label: 'Exit', action: () => w.close() },
      ] },
      { label: 'Image', items: () => [
        { label: 'Clear Image', action: () => { clear(); dirty = true; title(); } },
        { label: 'Invert Colors', action: invert },
        { label: 'Flip Horizontal', action: () => flip(true) },
        { label: 'Flip Vertical', action: () => flip(false) },
      ] },
      { label: 'Help', items: [{ label: 'About IR Paint', action: () => UI.alert('IR Paint 2.1\nLeft-click a color for the foreground, right-click for the background.', 'About IR Paint', '🎨') }] },
    ]);
    w.body.append(mb, el('div', { class: 'paint' },
      el('div', { class: 'paint-side' }, el('div', { class: 'paint-tools' }, toolBtns), sizeSel),
      el('div', { class: 'paint-canvas-wrap sunken' }, cv)),
    el('div', { class: 'paint-palette' }, el('div', { class: 'pal-cur sunken' }, bgBox, fgBox), pal, custom), status);

    function title() {
      w.setTitle(`${dirty ? '*' : ''}${file ? basename(file) : 'untitled'} - IR Paint`);
      status.firstChild.textContent = file ? prettyPath(file) : 'For Help, click About IR Paint on the Help menu.';
    }
    function load(p) {
      let data;
      try { data = VFS.read(p); } catch (e) { return UI.error(`${p}: ${e.message}`, 'IR Paint'); }
      if (!data.startsWith('data:image')) return UI.error('This file is not a valid image.', 'IR Paint');
      const img = new Image();
      img.onload = () => { cv.width = img.width; cv.height = img.height; ctx.drawImage(img, 0, 0); file = p; dirty = false; title(); };
      img.src = data;
    }
    async function save() {
      if (!file) return saveAs();
      try { VFS.write(file, cv.toDataURL('image/png')); dirty = false; title(); UI.notify('Image saved', prettyPath(file), '🎨'); }
      catch (e) { UI.error(e.message, 'IR Paint'); }
    }
    async function saveAs() {
      const p = await UI.prompt('Save picture as:', file || HOME + '/Pictures/' + VFS.uniqueName(HOME + '/Pictures', 'untitled.png'), 'Save As');
      if (!p) return;
      file = VFS.norm(p.endsWith('.png') ? p : p + '.png');
      save();
    }
    function invert() {
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255 - img.data[i]; img.data[i + 1] = 255 - img.data[i + 1]; img.data[i + 2] = 255 - img.data[i + 2]; }
      ctx.putImageData(img, 0, 0); dirty = true; title();
    }
    function flip(h) {
      const tmp = el('canvas', { width: cv.width, height: cv.height });
      tmp.getContext('2d').drawImage(cv, 0, 0);
      ctx.save();
      ctx.translate(h ? cv.width : 0, h ? 0 : cv.height);
      ctx.scale(h ? -1 : 1, h ? 1 : -1);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore(); dirty = true; title();
    }
    const posOf = e => {
      const r = cv.getBoundingClientRect();
      return { x: Math.floor((e.clientX - r.left) * cv.width / r.width), y: Math.floor((e.clientY - r.top) * cv.height / r.height) };
    };
    const color = () => (btn === 2 ? bg : fg);
    function stroke(a, b, width, col, cap = 'round') {
      ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = cap; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a.x + 0.5, a.y + 0.5); ctx.lineTo(b.x + 0.5, b.y + 0.5); ctx.stroke();
    }
    function spray(p) {
      ctx.fillStyle = color();
      const r = size * 3;
      for (let i = 0; i < size * 4; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r;
        ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1, 1);
      }
    }
    function shape(a, b) {
      ctx.putImageData(snap, 0, 0);
      ctx.strokeStyle = color(); ctx.lineWidth = size;
      ctx.beginPath();
      if (tool === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      else if (tool === 'rect') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    cv.oncontextmenu = e => e.preventDefault();
    cv.addEventListener('pointerdown', async e => {
      btn = e.button;
      const p = posOf(e);
      if (tool === 'fill') { floodFill(ctx, p.x, p.y, color()); dirty = true; title(); return; }
      if (tool === 'picker') {
        const d = ctx.getImageData(p.x, p.y, 1, 1).data;
        const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        if (btn === 2) bg = hex; else fg = hex;
        updateColors(); return;
      }
      if (tool === 'text') {
        const t = await UI.prompt('Text to place:', '', 'Text');
        if (t) { ctx.fillStyle = color(); ctx.font = `${Math.max(12, size * 4)}px Tahoma, sans-serif`; ctx.fillText(t, p.x, p.y); dirty = true; title(); }
        return;
      }
      drawing = true; start = last = p;
      cv.setPointerCapture(e.pointerId);
      snap = ctx.getImageData(0, 0, cv.width, cv.height);
      if (tool === 'spray') spray(p);
      else if (['pencil', 'brush', 'eraser'].includes(tool)) cv.dispatchEvent(new PointerEvent('pointermove', e));
    });
    cv.addEventListener('pointermove', e => {
      const p = posOf(e);
      status.lastChild.textContent = `${p.x}, ${p.y}`;
      if (!drawing) return;
      if (tool === 'pencil') stroke(last, p, 1, color(), 'square');
      else if (tool === 'brush') stroke(last, p, size, color());
      else if (tool === 'eraser') stroke(last, p, size * 3, bg, 'square');
      else if (tool === 'spray') spray(p);
      else shape(start, p);
      last = p;
    });
    cv.addEventListener('pointerup', () => { if (drawing) { drawing = false; dirty = true; title(); } });
    w.node.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
    w.onClose = () => {
      if (!dirty) return;
      UI.confirm('Discard changes to this picture?', 'IR Paint').then(ok => { if (ok) { dirty = false; w.close(); } });
      return false;
    };
    if (path) load(VFS.norm(path)); else title();
    return w;
  },
});

function floodFill(ctx, x, y, hex) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const i0 = (y * W + x) * 4, t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  if (t[0] === c[0] && t[1] === c[1] && t[2] === c[2] && t[3] === 255) return;
  const match = i => Math.abs(d[i] - t[0]) < 40 && Math.abs(d[i + 1] - t[1]) < 40 && Math.abs(d[i + 2] - t[2]) < 40 && Math.abs(d[i + 3] - t[3]) < 40;
  const seen = new Uint8Array(W * H);
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop(); let cx = stack.pop();
    while (cx >= 0 && !seen[cy * W + cx] && match((cy * W + cx) * 4)) cx--;
    cx++;
    let up = false, down = false;
    while (cx < W && !seen[cy * W + cx] && match((cy * W + cx) * 4)) {
      const i = (cy * W + cx) * 4;
      seen[cy * W + cx] = 1;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      if (cy > 0) { const ok = !seen[(cy - 1) * W + cx] && match(i - W * 4); if (ok && !up) stack.push(cx, cy - 1); up = ok; }
      if (cy < H - 1) { const ok = !seen[(cy + 1) * W + cx] && match(i + W * 4); if (ok && !down) stack.push(cx, cy + 1); down = ok; }
      cx++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- Image Viewer ----------
registerApp('viewer', {
  name: 'Image Viewer', icon: '🖼️', builtin: true, hidden: true,
  launch({ path }) {
    const w = WM.open({ title: `${basename(path)} - Image Viewer`, icon: '🖼️', app: 'viewer', width: 520, height: 420 });
    let data = '';
    try { data = VFS.read(path); } catch (e) { UI.error(e.message); }
    w.body.append(el('div', { class: 'viewer sunken' }, data.startsWith('data:image') ? el('img', { src: data }) : el('p', {}, 'Cannot display this file.')));
    return w;
  },
});

// ---------- Mines ----------
registerApp('mines', {
  name: 'Mines', icon: '💣', category: 'Games',
  launch() {
    const w = WM.open({ title: 'Mines', icon: '💣', app: 'mines', width: 220, height: 'auto', resizable: false, noMax: true });
    const LEVELS = { Beginner: [9, 9, 10], Intermediate: [16, 16, 40], Expert: [30, 16, 99] };
    let level = 'Beginner', W, H, M, cells, started, over, flags, revealed, timer, t0;
    const mineLed = el('div', { class: 'led' }), timeLed = el('div', { class: 'led' }), face = el('button', { class: 'btn face', onclick: () => reset() });
    const grid = el('div', { class: 'mgrid sunken' });
    const mb = UI.menubar([{ label: 'Game', items: () => [
      { label: 'New', hint: 'F2', action: () => reset() },
      '-',
      ...Object.keys(LEVELS).map(l => ({ label: l, checked: l === level, action: () => { level = l; reset(); } })),
      '-',
      { label: 'Exit', action: () => w.close() },
    ] }]);
    w.body.append(mb, el('div', { class: 'mines' }, el('div', { class: 'mines-head sunken' }, mineLed, face, timeLed), grid));
    const pad = n => (n < 0 ? '-' + String(-n).padStart(2, '0') : String(Math.min(999, n)).padStart(3, '0'));
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
    const nbrs = c => {
      const r = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const n = at(c.x + dx, c.y + dy); if (n) r.push(n); }
      return r;
    };
    function reset() {
      [W, H, M] = LEVELS[level];
      cells = []; started = false; over = false; flags = 0; revealed = 0;
      clearInterval(timer);
      timeLed.textContent = '000'; mineLed.textContent = pad(M); face.textContent = '🙂';
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = `repeat(${W}, 18px)`;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = { x, y, mine: false, open: false, flag: false, n: 0, el: el('div', { class: 'cell raised' }) };
        c.el.onpointerdown = e => { if (!over && e.button === 0) face.textContent = '😮'; };
        c.el.onpointerup = () => { if (!over) face.textContent = '🙂'; };
        c.el.onclick = () => open(c);
        c.el.oncontextmenu = e => { e.preventDefault(); flag(c); };
        cells.push(c);
        grid.append(c.el);
      }
      w.node.style.width = 'auto';
    }
    function plant(safe) {
      const banned = new Set([safe, ...nbrs(safe)]);
      let placed = 0;
      while (placed < M) {
        const c = cells[Math.floor(Math.random() * cells.length)];
        if (c.mine || banned.has(c)) continue;
        c.mine = true; placed++;
      }
      for (const c of cells) c.n = nbrs(c).filter(n => n.mine).length;
      started = true; t0 = Date.now();
      timer = setInterval(() => (timeLed.textContent = pad(Math.floor((Date.now() - t0) / 1000))), 250);
    }
    function open(c) {
      if (over || c.flag) return;
      if (!started) plant(c);
      if (c.open) {
        if (c.n && nbrs(c).filter(n => n.flag).length === c.n) for (const n of nbrs(c)) if (!n.open && !n.flag && !over) reveal(n);
      } else reveal(c);
      if (!over && revealed === W * H - M) win();
    }
    function reveal(c) {
      const stack = [c];
      while (stack.length) {
        const k = stack.pop();
        if (k.open || k.flag) continue;
        k.open = true; revealed++;
        k.el.className = 'cell open';
        if (k.mine) return boom(k);
        if (k.n) { k.el.textContent = k.n; k.el.classList.add('n' + k.n); } else stack.push(...nbrs(k));
      }
    }
    function flag(c) {
      if (over || c.open) return;
      c.flag = !c.flag;
      c.el.textContent = c.flag ? '🚩' : '';
      flags += c.flag ? 1 : -1;
      mineLed.textContent = pad(M - flags);
    }
    function boom(k) {
      over = true; clearInterval(timer); face.textContent = '😵';
      for (const c of cells) {
        if (c.mine && !c.flag) { c.el.className = 'cell open'; c.el.textContent = '💣'; }
        else if (!c.mine && c.flag) c.el.textContent = '❌';
      }
      k.el.classList.add('boom');
      Sound.ding();
    }
    function win() {
      over = true; clearInterval(timer); face.textContent = '😎';
      for (const c of cells) if (c.mine && !c.flag) { c.flag = true; c.el.textContent = '🚩'; }
      mineLed.textContent = '000';
      UI.notify('You win!', `Cleared ${level} in ${Math.floor((Date.now() - t0) / 1000)} seconds.`, '🏆');
    }
    w.node.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); reset(); } });
    w.onClose = () => clearInterval(timer);
    reset();
    WM.center(w);
    return w;
  },
});

// ---------- Clock ----------
registerApp('clock', {
  name: 'Clock', icon: '🕰️',
  launch() {
    const w = WM.open({ title: 'Clock', icon: '🕰️', app: 'clock', width: 250, height: 'auto', resizable: false, single: true });
    const cv = el('canvas', { width: 200, height: 200 });
    const ctx = cv.getContext('2d');
    const dig = el('div', { class: 'clock-dig' });
    const sw = el('div', { class: 'led clock-sw' }, '00:00.0');
    let swStart = null, swAcc = 0;
    const ssBtn = el('button', { class: 'btn', onclick: () => {
      if (swStart) { swAcc += Date.now() - swStart; swStart = null; ssBtn.textContent = 'Start'; }
      else { swStart = Date.now(); ssBtn.textContent = 'Stop'; }
    } }, 'Start');
    const rsBtn = el('button', { class: 'btn', onclick: () => { swAcc = 0; if (swStart) swStart = Date.now(); } }, 'Reset');
    w.body.append(el('div', { class: 'clock' }, el('div', { class: 'clock-face sunken' }, cv), dig,
      el('fieldset', { class: 'group' }, el('legend', {}, 'Stopwatch'), sw, el('div', { class: 'row' }, ssBtn, rsBtn))));
    function hand(angle, len, width, color) {
      ctx.save(); ctx.rotate(angle); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, len * 0.15); ctx.lineTo(0, -len); ctx.stroke(); ctx.restore();
    }
    function draw() {
      const d = new Date();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 200, 200);
      ctx.translate(100, 100);
      ctx.fillStyle = '#fffef4'; ctx.beginPath(); ctx.arc(0, 0, 94, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.stroke();
      for (let i = 0; i < 60; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 30);
        ctx.fillStyle = i % 5 ? '#888' : '#000';
        ctx.fillRect(i % 5 ? -0.5 : -1.5, -88, i % 5 ? 1 : 3, i % 5 ? 5 : 11);
        ctx.restore();
      }
      ctx.fillStyle = '#e95420'; ctx.font = 'bold 11px Tahoma'; ctx.textAlign = 'center'; ctx.fillText('IROS', 0, -40);
      const s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
      hand(h * Math.PI / 6, 50, 5, '#000');
      hand(m * Math.PI / 30, 72, 3, '#000');
      hand(s * Math.PI / 30, 80, 1.5, '#c00');
      ctx.fillStyle = '#c00'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      dig.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' — ' + d.toLocaleTimeString();
      const t = swAcc + (swStart ? Date.now() - swStart : 0);
      sw.textContent = `${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}.${Math.floor(t / 100) % 10}`;
    }
    const iv = setInterval(draw, 100);
    draw();
    w.onClose = () => clearInterval(iv);
    WM.center(w);
    return w;
  },
});

// ---------- System Monitor ----------
const SYSTEM_PROCS = [[1, 'systemd', 'root', 11.2], [2, 'kthreadd', 'root', 0], [212, 'systemd-journald', 'root', 8.4], [298, 'NetworkManager', 'root', 14.1],
  [312, 'iros-shell', 'user', 96.5], [340, 'Xorg', 'root', 54.0], [401, 'pulseaudio', 'user', 12.7], [455, 'dbus-daemon', 'user', 4.2]];

function processList() {
  return [
    ...SYSTEM_PROCS.map(([pid, name, user, mem]) => ({ pid, name, user, mem, sys: true })),
    ...WM.list().filter(w => !w.noTask).map(w => ({ pid: 1000 + w.id, name: w.app || 'window', title: w.title, user: Settings.get('username'), mem: 18 + ((w.id * 37) % 60) + 0.3, win: w })),
  ];
}

registerApp('sysmon', {
  name: 'System Monitor', icon: '📊', category: 'System',
  launch() {
    const w = WM.open({ title: 'System Monitor', icon: '📊', app: 'sysmon', width: 520, height: 400, single: true });
    let selPid = null, tab = 0;
    const cpuHist = Array(60).fill(5), memHist = Array(60).fill(30);
    const panel = el('div', { class: 'tabpanel raised' });
    w.body.append(UI.tabs(['Processes', 'Resources'], i => { tab = i; render(); }), panel);
    const cv = el('canvas', { width: 460, height: 130, class: 'graph' });
    const memBar = el('div', { class: 'progress sunken' }, el('i'));
    const stats = el('div', { class: 'stats' });
    function render() {
      panel.innerHTML = '';
      if (tab === 0) {
        const table = el('table', { class: 'list' }, el('tr', {}, ['PID', 'Process Name', 'User', 'Memory', 'Window'].map(h => el('th', {}, h))));
        for (const p of processList()) {
          const tr = el('tr', { class: p.pid === selPid ? 'sel' : '', onclick: () => { selPid = p.pid; render(); } },
            el('td', {}, p.pid), el('td', {}, p.name), el('td', {}, p.user), el('td', {}, p.mem.toFixed(1) + ' MB'), el('td', {}, p.title || ''));
          table.append(tr);
        }
        panel.append(el('div', { class: 'list-wrap sunken' }, table),
          el('div', { class: 'row end' }, el('button', { class: 'btn', onclick: endProcess }, 'End Process')));
      } else {
        panel.append(el('div', { class: 'label' }, 'CPU History'), cv, el('div', { class: 'label' }, 'Memory'), memBar, stats);
        drawGraph();
      }
    }
    function endProcess() {
      const p = processList().find(x => x.pid === selPid);
      if (!p) return UI.alert('Select a process first.', 'System Monitor');
      if (p.sys) return UI.error(`Cannot end process "${p.name}" (PID ${p.pid}): Operation not permitted.`, 'System Monitor');
      p.win.close();
    }
    function drawGraph() {
      const c = cv.getContext('2d'), W = cv.width, H = cv.height;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#063'; c.lineWidth = 1;
      for (let x = 0; x < W; x += 20) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
      for (let y = 0; y < H; y += 20) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
      const line = (hist, col) => {
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath();
        hist.forEach((v, i) => { const x = i * W / (hist.length - 1), y = H - v / 100 * H; i ? c.lineTo(x, y) : c.moveTo(x, y); });
        c.stroke();
      };
      line(memHist, '#e95420');
      line(cpuHist, '#0f0');
      const cpu = cpuHist.at(-1), mem = memHist.at(-1);
      memBar.firstChild.style.width = mem + '%';
      stats.textContent = `CPU: ${cpu.toFixed(0)}%   •   Memory: ${(mem * 40.96).toFixed(0)} MB of 4096 MB (${mem.toFixed(0)}%)   •   Processes: ${processList().length}   •   Uptime: ${fmtUptime()}`;
    }
    const iv = setInterval(() => {
      const busy = WM.list().length * 3;
      cpuHist.push(Math.max(2, Math.min(98, cpuHist.at(-1) * 0.6 + (Math.random() * 30 + busy) * 0.4)));
      memHist.push(Math.max(20, Math.min(90, 26 + WM.list().length * 4 + VFS.size() / 50000 + (Math.random() - 0.5) * 2)));
      cpuHist.shift(); memHist.shift();
      if (tab === 1) drawGraph();
    }, 1000);
    const off = Bus.on('windows', () => { if (tab === 0) render(); });
    w.onClose = () => { clearInterval(iv); off(); };
    render();
    return w;
  },
});

// ---------- Settings ----------
registerApp('settings', {
  name: 'Settings', icon: '⚙️', builtin: true, category: 'System',
  launch({ page = 'appearance' } = {}) {
    const w = WM.open({ title: 'Settings', icon: '⚙️', app: 'settings', width: 600, height: 430, single: true });
    const PAGES = [['appearance', '🎨', 'Appearance'], ['background', '🖼️', 'Background'], ['users', '👤', 'Users'], ['sound', '🔊', 'Sound'],
      ['software', '📦', 'Software'], ['about', 'ℹ️', 'About'], ['reset', '♻️', 'Reset']];
    const side = el('div', { class: 'set-side sunken' });
    const pane = el('div', { class: 'set-pane' });
    w.body.append(el('div', { class: 'settings' }, side, pane));
    function go(p) {
      page = p;
      side.innerHTML = '';
      for (const [id, ic, lb] of PAGES) side.append(el('div', { class: id === page ? 'on' : '', onclick: () => go(id) }, el('span', { class: 'ic' }, ic), lb));
      pane.innerHTML = '';
      pane.append(...(VIEWS[page] || VIEWS.appearance)());
    }
    const VIEWS = {
      appearance: () => [
        el('h2', {}, 'Appearance'),
        el('fieldset', { class: 'group' }, el('legend', {}, 'Theme'),
          Object.entries(THEMES).map(([id, name]) => el('label', { class: 'radio' },
            el('input', { type: 'radio', name: 'theme' + w.id, checked: Settings.get('theme') === id, onchange: () => Settings.set('theme', id) }), name))),
        el('div', { class: 'theme-preview' }, Object.keys(THEMES).map(id => el('div', { class: 'tp', 'data-theme': id, onclick: () => { Settings.set('theme', id); go('appearance'); } },
          el('div', { class: 'tp-bar' }, THEMES[id].split(' ')[0]), el('div', { class: 'tp-body' }, el('span', { class: 'tp-btn' }, 'OK'))))),
      ],
      background: () => [
        el('h2', {}, 'Desktop Background'),
        el('div', { class: 'wp-grid' }, Object.entries(WALLPAPERS).map(([id, wp]) => el('div', {
          class: 'wp' + (Settings.get('wallpaper') === id ? ' on' : ''),
          onclick: () => { Settings.set('wallpaper', id); go('background'); },
        }, el('div', { class: 'wp-thumb sunken', style: { background: wp.css || Settings.get('customColor') } }), el('div', {}, wp.name)))),
        el('label', { class: 'row' }, 'Solid color: ', el('input', { type: 'color', value: Settings.get('customColor'), oninput: e => { Settings.set('customColor', e.target.value); Settings.set('wallpaper', 'custom'); } })),
      ],
      users: () => {
        const inp = el('input', { class: 'field', value: Settings.get('username'), maxlength: '24' });
        return [
          el('h2', {}, 'Users'),
          el('div', { class: 'user-card' }, el('div', { class: 'avatar' }, '🦝'), el('div', {}, el('b', {}, Settings.get('username')), el('div', {}, 'Administrator (sudo)'))),
          el('label', { class: 'row' }, 'User name: ', inp,
            el('button', { class: 'btn', onclick: () => {
              const v = inp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
              if (!v) return UI.error('Please enter a valid user name (letters, digits, - and _).');
              Settings.set('username', v); go('users'); UI.notify('User renamed', `You are now ${v}.`, '👤');
            } }, 'Apply')),
          el('p', { class: 'muted' }, 'Your home folder stays at /home/user. Any password works for sudo.'),
        ];
      },
      sound: () => [
        el('h2', {}, 'Sound'),
        el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: Settings.get('sound'), onchange: e => Settings.set('sound', e.target.checked) }), 'Enable system sounds'),
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => Sound.startup() }, '▶ Startup'), el('button', { class: 'btn', onclick: () => Sound.ding() }, '▶ Error'), el('button', { class: 'btn', onclick: () => Sound.pop() }, '▶ Notification')),
      ],
      software: () => [
        el('h2', {}, 'Software'),
        el('p', {}, `Installed packages: ${Settings.get('installed').length ? Settings.get('installed').join(', ') : 'none (only built-in apps)'}`),
        el('button', { class: 'btn', onclick: () => launch('software') }, '🛍️ Open Software Center'),
        el('p', { class: 'muted' }, 'Or use the terminal: sudo apt install <package>'),
      ],
      about: () => [
        el('div', { class: 'about' },
          el('div', { class: 'about-logo' }, 'IROS'),
          el('div', {},
            el('h2', {}, `IROS ${VERSION}`),
            el('div', {}, `"${CODENAME}"`),
            el('p', {}, 'A classic 90s desktop with a Linux heart.'),
            el('table', { class: 'kv' }, [
              ['Kernel', '6.8.0-iros (browser)'], ['Desktop', 'IROS Shell'], ['Processor', `${navigator.hardwareConcurrency || 4} × Virtual CPU`],
              ['Disk used', fmtSize(VFS.size())], ['Packages', String(Object.values(APPS).filter(a => a.builtin).length + Settings.get('installed').length)], ['Uptime', fmtUptime()],
            ].map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v)))))),
      ],
      reset: () => [
        el('h2', {}, 'Reset'),
        el('p', {}, 'Erase all files, settings and installed packages and restore IROS to factory defaults.'),
        el('button', { class: 'btn', onclick: async () => {
          if (await UI.confirm('This will permanently delete all your files and settings. Continue?', 'Factory Reset')) { Store.clear(); location.reload(); }
        } }, '♻️ Factory Reset...'),
      ],
    };
    const off = Bus.on('settings', k => { if (k === 'theme' && page === 'appearance') go(page); });
    w.onClose = off;
    go(page);
    return w;
  },
});

// ---------- Software Center ----------
registerApp('software', {
  name: 'Software Center', icon: '🛍️', builtin: true, category: 'System',
  launch({ focus } = {}) {
    const w = WM.open({ title: 'Software Center', icon: '🛍️', app: 'software', width: 600, height: 460, single: true });
    let tab = 0, q = '';
    const busy = {};
    const search = el('input', { class: 'field', placeholder: 'Search software…', oninput: e => { q = e.target.value.toLowerCase(); render(); } });
    const list = el('div', { class: 'pkg-list sunken' });
    w.body.append(
      el('div', { class: 'sc-head' }, el('div', { class: 'sc-title' }, '🛍️ Software Center'), search),
      UI.tabs(['Explore', 'Installed'], i => { tab = i; render(); }),
      el('div', { class: 'tabpanel raised' }, list));
    function render() {
      list.innerHTML = '';
      const builtins = Object.values(APPS).filter(a => a.builtin && !a.hidden).map(a => ({ id: a.id, name: a.name, icon: a.icon, version: VERSION.split(' ')[0], kb: 0, kind: 'app', desc: 'Part of the IROS base system.', system: true }));
      let items = tab === 0 ? Packages.catalog : [...builtins, ...Packages.catalog.filter(p => Packages.isInstalled(p.id))];
      if (q) items = items.filter(p => (p.name + ' ' + p.desc).toLowerCase().includes(q));
      if (!items.length) list.append(el('div', { class: 'fm-empty' }, 'No matching software'));
      for (const p of items) {
        const inst = p.system || Packages.isInstalled(p.id);
        const actions = el('div', { class: 'pkg-actions' });
        if (busy[p.id] != null) actions.append(el('div', { class: 'progress sunken' }, el('i', { style: { width: busy[p.id] + '%' } })));
        else if (p.system) actions.append(el('span', { class: 'muted' }, 'System'));
        else if (inst) {
          if (p.kind === 'app') actions.append(el('button', { class: 'btn', onclick: () => launch(p.id) }, 'Open'));
          actions.append(el('button', { class: 'btn', onclick: () => remove(p) }, 'Remove'));
        } else actions.append(el('button', { class: 'btn primary', onclick: () => install(p) }, 'Install'));
        const row = el('div', { class: 'pkg' + (focus === p.id ? ' hl' : '') },
          el('div', { class: 'ic' }, p.icon),
          el('div', { class: 'info' }, el('b', {}, p.name), el('span', { class: 'muted' }, ` ${p.version}${p.kb ? ' · ' + fmtSize(p.kb * 1024) : ''}${p.kind === 'cmd' ? ' · terminal command' : ''}`), el('div', { class: 'desc' }, p.desc)),
          actions);
        list.append(row);
        if (focus === p.id) setTimeout(() => row.scrollIntoView({ block: 'nearest' }));
      }
    }
    async function install(p) {
      busy[p.id] = 0; render();
      while (busy[p.id] < 100) {
        await sleep(80 + Math.random() * 80);
        busy[p.id] = Math.min(100, busy[p.id] + 4 + Math.random() * 12);
        render();
      }
      delete busy[p.id];
      Packages.install(p.id);
      UI.notify(`${p.name} installed`, p.kind === 'app' ? 'Find it in the Start menu or Activities.' : `Run it in the Terminal: ${p.id}`, p.icon);
    }
    async function remove(p) {
      if (!await UI.confirm(`Remove ${p.name}?`, 'Software Center')) return;
      Packages.remove(p.id);
      UI.notify(`${p.name} removed`, '', '🗑️');
    }
    const off = Bus.on('packages', render);
    w.onClose = off;
    render();
    return w;
  },
});

// ---------- Help ----------
registerApp('help', {
  name: 'Help', icon: '❓', builtin: true, hidden: true,
  launch() {
    const w = WM.open({ title: 'IROS Help', icon: '❓', app: 'help', width: 560, height: 460, single: true });
    w.body.append(el('div', { class: 'help sunken', html: `
      <h2>Welcome to IROS ${VERSION}</h2>
      <p>IROS mixes a classic 90s desktop (Start menu, taskbar, beveled windows) with Linux / Ubuntu ideas
      (a bash-style terminal, <code>apt</code> and <code>sudo</code>, a Software Center, workspaces and an Activities overview).</p>
      <h3>Keyboard shortcuts</h3>
      <table class="kv">
        <tr><td><kbd>Ctrl</kbd>+<kbd>Space</kbd> or tap <kbd>Super</kbd></td><td>Activities overview (search apps &amp; files)</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd></td><td>Open a Terminal</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd></td><td>Switch workspace</td></tr>
        <tr><td><kbd>Alt</kbd>+<kbd>W</kbd></td><td>Close the active window</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close menus and the overview</td></tr>
      </table>
      <h3>Terminal</h3>
      <p>Type <code>help</code> for a list of commands. Supports pipes (<code>|</code>), redirection (<code>&gt;</code>, <code>&gt;&gt;</code>),
      <code>&amp;&amp;</code>, <code>;</code>, variables, wildcards, Tab completion and history.</p>
      <p>Try: <code>sudo apt install neofetch cowsay fortune</code>, then <code>neofetch</code> and <code>fortune | cowsay</code>.</p>
      <h3>Files</h3>
      <p>All files live in a virtual file system saved in your browser's local storage.
      Deleted items go to the Trash, where you can restore them.</p>
      <h3>Workspaces</h3>
      <p>Use the <b>1 2 3 4</b> buttons in the tray. Right-click a taskbar button to move a window to another workspace.</p>` }));
    return w;
  },
});
