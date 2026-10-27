'use strict';

// ---- Virtual file system, persisted to localStorage ----

const VFS = (() => {
  const KEY = 'iros.fs.v1';
  const now = () => Date.now();
  const D = (children = {}) => ({ type: 'dir', children, mtime: now() });
  const F = (content = '') => ({ type: 'file', content, mtime: now() });
  const err = msg => new Error(msg);
  let root;

  const WELCOME = `Welcome to IROS ${VERSION} "${CODENAME}"!

IROS is a hybrid desktop: the look and feel of a classic 90s
desktop with a Linux (Ubuntu-style) heart.

Things to try:
  * Double-click the icons on the desktop.
  * Click Start for the classic menu, or press Ctrl+Space
    for the Activities overview (search apps and files).
  * Press Ctrl+Alt+T to open a Terminal. Try:
        ls -l
        neofetch
        sudo apt install neofetch cowsay fortune
        fortune | cowsay
        bash ~/Documents/hello.sh
  * Install more apps from the Software Center.
  * Use the 1-2-3-4 buttons in the tray to switch workspaces
    (or Ctrl+Alt+Left/Right).
  * Right-click the desktop to create files and folders.

Everything you create is saved in your browser.
`;

  function defaults() {
    return D({
      bin: D({}),
      etc: D({
        hostname: F('iros\n'),
        'os-release': F(`NAME="IROS"\nVERSION="${VERSION} (${CODENAME})"\nID=iros\nID_LIKE=ubuntu debian\nPRETTY_NAME="IROS ${VERSION}"\n`),
        motd: F(`Welcome to IROS ${VERSION}!\n`),
      }),
      home: D({
        user: D({
          Desktop: D({ 'Welcome.txt': F(WELCOME) }),
          Documents: D({
            'notes.txt': F('Shopping list:\n- milk\n- floppy disks\n- coffee\n- more floppy disks\n'),
            'hello.sh': F('#!/bin/bash\n# A tiny demo script. Run it with: bash ~/Documents/hello.sh\necho "Hello from a shell script, $USER!"\necho "Today is:"\ndate\necho "Your home folder contains:"\nls ~\n'),
          }),
          Pictures: D({}),
          Music: D({ 'playlist.txt': F('1. Dial-up Modem Symphony\n2. Floppy Drive Blues\n3. The Startup Chime (Extended Mix)\n') }),
          Downloads: D({}),
          '.bashrc': F('# ~/.bashrc\nalias ll="ls -l"\nalias la="ls -a"\n'),
          '.local': D({ share: D({ Trash: D({}) }) }),
        }),
      }),
      tmp: D({}),
      usr: D({ bin: D({}), share: D({}) }),
      var: D({ log: D({ syslog: F('[    0.000000] IROS kernel booting...\n[    0.120000] VFS: mounted root (localStorage) readonly=0\n') }) }),
    });
  }

  function load() {
    root = Store.get(KEY, null) || defaults();
  }
  function save() {
    if (!Store.set(KEY, root)) {
      if (typeof UI !== 'undefined') UI.notify('Disk full', 'Browser storage quota exceeded — last change not saved.', '💾');
    }
    Bus.emit('fs');
  }
  function reset() { root = defaults(); save(); }

  function norm(path, cwd = HOME) {
    if (!path) path = '.';
    path = path.replace(/^~(?=\/|$)/, HOME);
    const parts = (path.startsWith('/') ? path : cwd + '/' + path).split('/');
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop(); else out.push(p);
    }
    return '/' + out.join('/');
  }
  const join = (a, b) => norm(b, a);

  function get(path) {
    let n = root;
    for (const p of norm(path).split('/').filter(Boolean)) {
      if (!n || n.type !== 'dir') return null;
      n = n.children[p];
    }
    return n || null;
  }
  const exists = p => !!get(p);
  const isDir = p => get(p)?.type === 'dir';

  function parentOf(path) {
    const p = norm(path);
    if (p === '/') throw err('Operation not permitted');
    const dir = get(dirname(p));
    if (!dir) throw err('No such file or directory');
    if (dir.type !== 'dir') throw err('Not a directory');
    return [dir, basename(p)];
  }

  function mkdir(path, parents = false) {
    const p = norm(path);
    const n = get(p);
    if (n) { if (parents && n.type === 'dir') return n; throw err('File exists'); }
    if (parents && !get(dirname(p))) mkdir(dirname(p), true);
    const [dir, name] = parentOf(p);
    dir.children[name] = D();
    dir.mtime = now();
    save();
    return dir.children[name];
  }

  function write(path, content, append = false) {
    const [dir, name] = parentOf(path);
    const n = dir.children[name];
    if (n?.type === 'dir') throw err('Is a directory');
    if (n) { n.content = append ? n.content + content : content; n.mtime = now(); }
    else dir.children[name] = F(content);
    dir.mtime = now();
    save();
  }

  function create(path) {
    if (exists(path)) throw err('File exists');
    write(path, '');
  }

  function touch(path) {
    const n = get(path);
    if (n) { n.mtime = now(); save(); } else write(path, '');
  }

  function read(path) {
    const n = get(path);
    if (!n) throw err('No such file or directory');
    if (n.type === 'dir') throw err('Is a directory');
    return n.content;
  }

  function list(path, hidden = false) {
    const n = get(path);
    if (!n) throw err('No such file or directory');
    if (n.type !== 'dir') throw err('Not a directory');
    return Object.keys(n.children)
      .filter(k => hidden || !k.startsWith('.'))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  function remove(path, recursive = false) {
    const p = norm(path);
    const n = get(p);
    if (!n) throw err('No such file or directory');
    if (n.type === 'dir' && !recursive) throw err('Is a directory');
    const [dir, name] = parentOf(p);
    delete dir.children[name];
    dir.mtime = now();
    save();
  }

  function rmdir(path) {
    const n = get(path);
    if (!n) throw err('No such file or directory');
    if (n.type !== 'dir') throw err('Not a directory');
    if (Object.keys(n.children).length) throw err('Directory not empty');
    remove(path, true);
  }

  function resolveDest(src, dst) {
    let d = norm(dst);
    if (isDir(d)) d = join(d, basename(src));
    if (d === src) throw err('source and destination are the same');
    if (d.startsWith(src + '/')) throw err('cannot move a directory into itself');
    if (isDir(d)) throw err('destination is a directory');
    return d;
  }

  function move(src, dst) {
    const s = norm(src);
    const n = get(s);
    if (!n) throw err('No such file or directory');
    const d = resolveDest(s, dst);
    const [sdir, sname] = parentOf(s);
    const [ddir, dname] = parentOf(d);
    delete sdir.children[sname];
    ddir.children[dname] = n;
    n.mtime = sdir.mtime = ddir.mtime = now();
    save();
    return d;
  }

  function copy(src, dst) {
    const s = norm(src);
    const n = get(s);
    if (!n) throw err('No such file or directory');
    const d = resolveDest(s, dst);
    const [ddir, dname] = parentOf(d);
    ddir.children[dname] = JSON.parse(JSON.stringify(n));
    ddir.children[dname].mtime = ddir.mtime = now();
    save();
    return d;
  }

  function uniqueName(dir, name) {
    if (!exists(join(dir, name))) return name;
    const m = name.match(/^(.*?)(\.[^.]*)?$/);
    for (let i = 2; ; i++) {
      const cand = `${m[1]} (${i})${m[2] || ''}`;
      if (!exists(join(dir, cand))) return cand;
    }
  }

  function trash(path) {
    const p = norm(path);
    if (p === HOME || p === '/' || p.startsWith(TRASH)) throw err('Cannot move this item to the Trash');
    if (!isDir(TRASH)) mkdir(TRASH, true);
    const n = get(p);
    if (!n) throw err('No such file or directory');
    n.orig = p;
    move(p, join(TRASH, uniqueName(TRASH, basename(p))));
  }

  function restore(path) {
    const n = get(path);
    if (!n) throw err('No such file or directory');
    const orig = n.orig || join(HOME, basename(path));
    const dir = dirname(orig);
    if (!isDir(dir)) mkdir(dir, true);
    delete n.orig;
    move(path, join(dir, uniqueName(dir, basename(orig))));
  }

  function walk(path, fn, depth = 0) {
    const n = get(path);
    if (!n) return;
    fn(norm(path), n, depth);
    if (n.type === 'dir') for (const k of Object.keys(n.children).sort()) walk(join(path, k), fn, depth + 1);
  }

  function size(path = '/') {
    let total = 0;
    walk(path, (_, n) => { if (n.type === 'file') total += n.content.length; });
    return total;
  }

  return { load, save, reset, norm, join, get, exists, isDir, mkdir, write, create, touch, read, list, remove, rmdir, move, copy, uniqueName, trash, restore, walk, size };
})();
