'use strict';

// ---- Bash-like terminal ----

const COMMANDS = {};
function cmd(names, help, fn, pkg) {
  for (const n of [].concat(names)) COMMANDS[n] = { help, fn, pkg };
}

const APP_ALIASES = {
  files: 'files', nautilus: 'files', explorer: 'files',
  gedit: 'editor', notepad: 'editor', editor: 'editor',
  calc: 'calc', 'gnome-calculator': 'calc',
  paint: 'paint', mspaint: 'paint',
  sysmon: 'sysmon', 'gnome-system-monitor': 'sysmon', taskmgr: 'sysmon', htop: 'sysmon',
  mines: 'mines', 'gnome-mines': 'mines',
  clock: 'clock', 'gnome-clocks': 'clock',
  software: 'software', 'gnome-software': 'software',
  settings: 'settings', 'gnome-control-center': 'settings', control: 'settings',
  terminal: 'terminal', 'gnome-terminal': 'terminal',
};

function parseFlags(args) {
  const flags = new Set(), rest = [];
  let n = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n' && /^\d+$/.test(args[i + 1] || '')) { n = +args[++i]; continue; }
    if (/^-\d+$/.test(a)) { n = +a.slice(1); continue; }
    if (a.startsWith('--') && a.length > 2) flags.add(a.slice(2));
    else if (a.startsWith('-') && a.length > 1) for (const c of a.slice(1)) flags.add(c);
    else rest.push(a);
  }
  return { flags, rest, n };
}

function fmtLsDate(t) {
  const d = new Date(t);
  return `${d.toLocaleString('en', { month: 'short' })} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

class Terminal {
  constructor({ cwd = HOME, run } = {}) {
    this.cwd = VFS.isDir(cwd) ? VFS.norm(cwd) : HOME;
    this.history = Store.get('iros.history', []);
    this.hidx = this.history.length;
    this.env = { HOME, USER: Settings.get('username'), SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', PWD: this.cwd, HOSTNAME: 'iros' };
    this.aliases = { ll: 'ls -l', la: 'ls -a', l: 'ls', dir: 'ls', md: 'mkdir' };
    this.status = 0;
    this.sudoUntil = 0;
    this.root = false;
    this.reader = null;
    this.busy = false;
    this.loadBashrc();

    const w = this.win = WM.open({ title: 'Terminal', icon: '💻', app: 'terminal', width: 660, height: 410 });
    this.out = el('div', { class: 'term-out' });
    this.ps = el('span', { class: 'term-ps' });
    this.input = el('input', { class: 'term-in', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
    this.line = el('div', { class: 'term-line' }, this.ps, this.input);
    this.screen = el('div', { class: 'term' }, this.out, this.line);
    const mb = UI.menubar([
      { label: 'File', items: [{ label: 'New Terminal', hint: 'Ctrl+Alt+T', action: () => launch('terminal', { cwd: this.cwd }) }, '-', { label: 'Close', action: () => w.close() }] },
      { label: 'Edit', items: [{ label: 'Clear Screen', hint: 'Ctrl+L', action: () => this.clear() }, { label: 'Clear History', action: () => { this.history = []; this.hidx = 0; Store.set('iros.history', []); } }] },
      { label: 'Help', items: [{ label: 'Commands', action: () => this.submit('help') }] },
    ]);
    w.body.append(mb, this.screen);
    this.screen.addEventListener('mouseup', () => { if (!getSelection().toString()) this.input.focus(); });
    this.input.addEventListener('keydown', e => this.key(e));
    w.onClose = () => { this.closed = true; };
    this.updatePrompt();
    this.printHTML(`<span class="t-dim">IROS ${VERSION} (GNU/Linux 6.8.0-iros x86_64)\n\n * Help:      type 'help'\n * Software:  sudo apt install &lt;package&gt;\n\n</span>`);
    setTimeout(() => this.input.focus());
    if (run) this.submit(run);
  }

  loadBashrc() {
    try {
      for (const line of VFS.read(HOME + '/.bashrc').split('\n')) {
        const m = line.match(/^\s*alias\s+([\w.-]+)=["']?(.*?)["']?\s*$/);
        if (m) this.aliases[m[1]] = m[2];
      }
    } catch { }
  }

  // ---------- output ----------
  promptHTML() {
    const u = this.env.USER;
    return `<span class="t-user">${escapeHTML(u)}@iros</span>:<span class="t-path">${escapeHTML(prettyPath(this.cwd))}</span>$ `;
  }
  updatePrompt() {
    this.ps.innerHTML = this.promptHTML();
    this.win.setTitle(`${this.env.USER}@iros: ${prettyPath(this.cwd)}`);
  }
  print(text, cls) {
    const s = el('span', cls ? { class: cls } : {}, text);
    this.out.append(s);
    this.scroll();
    return s;
  }
  printHTML(html) { const s = el('span', { html }); this.out.append(s); this.scroll(); return s; }
  scroll() { this.screen.scrollTop = this.screen.scrollHeight; }
  clear() { this.out.innerHTML = ''; }
  cols() { return Math.max(40, Math.floor((this.screen.clientWidth - 12) / 7.8)); }

  readLine(prompt, hidden = false) {
    return new Promise(resolve => {
      this.ps.textContent = prompt;
      this.input.type = hidden ? 'password' : 'text';
      this.line.style.display = '';
      this.reader = { prompt, hidden, resolve };
      this.input.focus();
      this.scroll();
    });
  }

  // ---------- input ----------
  key(e) {
    if (this.reader) {
      if (e.key === 'Enter' || (e.ctrlKey && e.key === 'c')) {
        e.preventDefault();
        const r = this.reader, v = e.key === 'Enter' ? this.input.value : null;
        this.reader = null;
        this.input.value = '';
        this.input.type = 'text';
        this.line.style.display = 'none';
        this.print(r.prompt + (r.hidden || v == null ? '' : v) + (v == null ? '^C' : '') + '\n');
        r.resolve(v);
      }
      return;
    }
    if (this.busy) {
      if (e.ctrlKey && e.key === 'c') this.abort = true;
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = this.input.value;
      this.input.value = '';
      this.submit(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.hidx > 0) this.input.value = this.history[--this.hidx];
      setTimeout(() => this.input.setSelectionRange(9999, 9999));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.hidx = Math.min(this.history.length, this.hidx + 1);
      this.input.value = this.history[this.hidx] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.complete();
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      this.clear();
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      this.printHTML(this.promptHTML() + escapeHTML(this.input.value) + '^C\n');
      this.input.value = '';
    } else if (e.ctrlKey && e.key === 'd' && !this.input.value) {
      e.preventDefault();
      this.win.close();
    }
  }

  complete() {
    const v = this.input.value.slice(0, this.input.selectionStart);
    const after = this.input.value.slice(this.input.selectionStart);
    const word = v.match(/(\S*)$/)[1];
    const before = v.slice(0, v.length - word.length);
    const first = !before.trim() || /(\||;|&&|sudo)\s*$/.test(before);
    let cands;
    if (first && !word.includes('/')) {
      const names = [...Object.keys(COMMANDS).filter(c => !COMMANDS[c].pkg || Packages.isInstalled(COMMANDS[c].pkg)),
        ...Object.keys(this.aliases), ...Object.keys(APP_ALIASES).filter(a => Packages.isInstalled(APP_ALIASES[a]))];
      cands = [...new Set(names)].filter(c => c.startsWith(word)).sort().map(c => c + ' ');
    } else {
      const slash = word.lastIndexOf('/');
      const dpart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const base = word.slice(slash + 1);
      let names = [];
      try { names = VFS.list(this.abs(dpart || '.'), base.startsWith('.')); } catch { }
      cands = names.filter(n => n.startsWith(base)).map(n => dpart + n + (VFS.isDir(this.abs(dpart + n)) ? '/' : ' '));
    }
    if (!cands.length) return;
    const set = s => { this.input.value = before + s + after; const p = (before + s).length; this.input.setSelectionRange(p, p); };
    if (cands.length === 1) return set(cands[0]);
    let pre = cands[0];
    for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
    if (pre.length > word.length) return set(pre);
    this.printHTML(this.promptHTML() + escapeHTML(this.input.value) + '\n');
    this.print(cands.map(c => c.trim().split('/').filter(Boolean).pop() + (c.endsWith('/') ? '/' : '')).join('  ') + '\n');
  }

  async submit(line) {
    this.printHTML(this.promptHTML() + escapeHTML(line) + '\n');
    if (line.trim()) {
      if (this.history.at(-1) !== line) this.history.push(line);
      if (this.history.length > 500) this.history.shift();
      Store.set('iros.history', this.history);
    }
    this.hidx = this.history.length;
    this.line.style.display = 'none';
    this.busy = true;
    this.abort = false;
    try { await this.run(line); }
    catch (err) { this.print(String(err.message || err) + '\n', 't-err'); this.status = 1; }
    this.busy = false;
    if (this.closed) return;
    this.line.style.display = '';
    this.updatePrompt();
    this.input.focus();
    this.scroll();
  }

  // ---------- parsing ----------
  abs(p) { return VFS.norm(p, this.cwd); }

  varValue(name) {
    name = name.replace(/[{}]/g, '');
    if (name === '?') return String(this.status);
    if (name === 'PWD') return this.cwd;
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    return this.env[name] ?? '';
  }

  tokenize(s) {
    const toks = [];
    let cur = '', q = null, has = false;
    const push = () => { if (has) { toks.push(cur); cur = ''; has = false; } };
    const VAR = /^\$(\w+|\{\w+\}|\?)/;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === q) q = null;
        else if (c === '$' && q === '"' && VAR.test(s.slice(i))) { const m = s.slice(i).match(VAR); cur += this.varValue(m[1]); i += m[0].length - 1; }
        else cur += c;
        continue;
      }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
      if (/\s/.test(c)) { push(); continue; }
      if (c === '$' && VAR.test(s.slice(i))) { const m = s.slice(i).match(VAR); cur += this.varValue(m[1]); has = true; i += m[0].length - 1; continue; }
      if (c === '~' && !has && (i + 1 === s.length || /[\s/]/.test(s[i + 1]))) { cur += HOME; has = true; continue; }
      if (c === '#' && !has) break;
      if ('|;>&<'.includes(c)) {
        push();
        const two = s.slice(i, i + 2);
        if (two === '>>' || two === '&&' || two === '||') { toks.push({ op: two }); i++; }
        else toks.push({ op: c });
        continue;
      }
      cur += c; has = true;
    }
    if (q) throw new Error(`bash: unexpected EOF while looking for matching \`${q}'`);
    push();
    return toks;
  }

  async run(line) {
    const toks = this.tokenize(line);
    const chains = [];
    let seg = [], cond = null;
    for (const t of toks) {
      if (typeof t === 'object' && [';', '&&', '||', '&'].includes(t.op)) {
        chains.push({ toks: seg, cond });
        seg = [];
        cond = t.op === '&&' || t.op === '||' ? t.op : null;
      } else seg.push(t);
    }
    chains.push({ toks: seg, cond });
    for (const c of chains) {
      if (!c.toks.length || this.closed) continue;
      if (c.cond === '&&' && this.status !== 0) continue;
      if (c.cond === '||' && this.status === 0) continue;
      this.status = await this.pipeline(c.toks);
    }
  }

  async pipeline(toks) {
    const stages = [[]];
    for (const t of toks) { if (t.op === '|') stages.push([]); else stages.at(-1).push(t); }
    let stdin = null, status = 0;
    for (let i = 0; i < stages.length; i++) {
      let args = stages[i], redirect = null;
      const ri = args.findIndex(t => t.op === '>' || t.op === '>>');
      if (ri >= 0) {
        const target = args[ri + 1];
        if (typeof target !== 'string') throw new Error("bash: syntax error near unexpected token `newline'");
        redirect = { append: args[ri].op === '>>', path: target };
        args = args.slice(0, ri).concat(args.slice(ri + 2));
      }
      const li = args.findIndex(t => t.op === '<');
      if (li >= 0) {
        const src = args[li + 1];
        if (typeof src !== 'string') throw new Error("bash: syntax error near unexpected token `newline'");
        try { stdin = VFS.read(this.abs(src)); } catch (e) { throw new Error(`bash: ${src}: ${e.message}`); }
        args = args.slice(0, li).concat(args.slice(li + 2));
      }
      if (args.some(t => typeof t === 'object')) throw new Error(`bash: syntax error near unexpected token \`${args.find(t => typeof t === 'object').op}'`);
      if (!args.length) continue;
      const live = i === stages.length - 1 && !redirect;
      let buf = '';
      const io = {
        stdin, live,
        out: s => { if (live) this.print(s); else buf += s; },
        html: h => { if (live) this.printHTML(h); else buf += h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); },
        err: s => this.print(s, 't-err'),
      };
      try { status = (await this.exec(args, io)) ?? 0; }
      catch (err) { io.err(err.message.replace(/\n?$/, '\n')); status = 1; }
      if (redirect) {
        try { VFS.write(this.abs(redirect.path), buf, redirect.append); }
        catch (e) { this.print(`bash: ${redirect.path}: ${e.message}\n`, 't-err'); status = 1; }
      }
      stdin = buf;
    }
    return status;
  }

  glob(args) {
    const out = [];
    for (const a of args) {
      if (!/[*?]/.test(a)) { out.push(a); continue; }
      const slash = a.lastIndexOf('/');
      const dpart = slash >= 0 ? a.slice(0, slash + 1) : '';
      const pat = a.slice(slash + 1);
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      let names = [];
      try { names = VFS.list(this.abs(dpart || '.'), pat.startsWith('.')).filter(n => re.test(n)); } catch { }
      if (names.length) out.push(...names.map(n => dpart + n)); else out.push(a);
    }
    return out;
  }

  async exec(args, io) {
    let [name, ...rest] = args;
    if (this.aliases[name]) {
      const exp = this.tokenize(this.aliases[name]).filter(t => typeof t === 'string');
      name = exp[0];
      rest = [...exp.slice(1), ...rest];
    }
    rest = this.glob(rest);
    if (/^\w+=/.test(name) && !rest.length) {
      const i = name.indexOf('=');
      this.env[name.slice(0, i)] = name.slice(i + 1);
      return 0;
    }
    const c = COMMANDS[name];
    if (c) {
      if (c.pkg && !Packages.isInstalled(c.pkg)) return this.notFound(name, io);
      try { return await c.fn.call(this, rest, io, name); }
      catch (err) {
        if (err.wrapped) throw err;
        const e = new Error(`${name}: ${err.message}`);
        e.wrapped = true;
        throw e;
      }
    }
    const app = APP_ALIASES[name];
    if (app) {
      if (!Packages.isInstalled(app)) return this.notFound(name, io, app);
      const p = rest[0] ? this.abs(rest[0]) : null;
      launch(app, app === 'terminal' ? { cwd: this.cwd } : app === 'files' ? { path: p || this.cwd } : p ? { path: p } : {});
      return 0;
    }
    if (name.includes('/')) {
      const p = this.abs(name), n = VFS.get(p);
      if (n?.type === 'file') return this.runScript(p, rest);
      if (n) throw new Error(`bash: ${name}: Is a directory`);
      throw new Error(`bash: ${name}: No such file or directory`);
    }
    return this.notFound(name, io);
  }

  notFound(name, io, pkg) {
    const p = pkg || (Packages.find(name) ? name : null);
    if (p) io.err(`Command '${name}' not found, but can be installed with:\n\nsudo apt install ${p}\n\n`);
    else io.err(`${name}: command not found\n`);
    return 127;
  }

  async runScript(path, args) {
    const saved = {};
    args.forEach((a, i) => { saved[i + 1] = this.env[i + 1]; this.env[i + 1] = a; });
    try {
      for (const line of VFS.read(path).split('\n')) {
        if (this.abort || this.closed) break;
        if (line.trim() && !line.trim().startsWith('#')) await this.run(line);
      }
    } finally {
      Object.assign(this.env, saved);
    }
    return this.status;
  }

  readInputs(files, io) {
    if (!files.length) return [io.stdin ?? ''];
    return files.map(f => {
      if (f === '-') return io.stdin ?? '';
      const p = this.abs(f);
      try { return VFS.read(p); } catch (e) { throw new Error(`${f}: ${e.message}`); }
    });
  }
}

registerApp('terminal', {
  name: 'Terminal', icon: '💻', builtin: true, category: 'System',
  launch(opts = {}) { return new Terminal(opts).win; },
});

// ================= Commands =================

const colorName = (name, node) => {
  const e = escapeHTML(name);
  if (node?.type === 'dir') return `<span class="t-dir">${e}</span>`;
  if (/\.sh$/.test(name)) return `<span class="t-exe">${e}</span>`;
  if (/\.(png|jpe?g|gif)$/.test(name)) return `<span class="t-img">${e}</span>`;
  return e;
};

cmd('help', 'show this help', function (args, io) {
  if (args[0]) {
    const c = COMMANDS[args[0]];
    io.out(c ? `${args[0]} - ${c.help}\n` : `help: no help topics match '${args[0]}'\n`);
    return c ? 0 : 1;
  }
  const names = Object.keys(COMMANDS).filter(n => !COMMANDS[n].pkg || Packages.isInstalled(COMMANDS[n].pkg)).sort();
  const w = Math.max(...names.map(n => n.length)) + 2;
  const perRow = Math.max(1, Math.floor(this.cols() / w));
  let s = `IROS bash, version 5.2.21(1)-release\nAvailable commands:\n\n`;
  for (let i = 0; i < names.length; i += perRow) s += '  ' + names.slice(i, i + perRow).map(n => n.padEnd(w)).join('') + '\n';
  s += `\nApps: ${Object.keys(APP_ALIASES).filter(a => Packages.isInstalled(APP_ALIASES[a])).slice(0, 14).join(', ')} …\n`;
  s += `Type 'help <command>' or 'man <command>' for details.  Tab completes, ↑/↓ browse history, Ctrl+L clears.\n`;
  io.out(s);
});

cmd(['man', 'whatis'], 'show the manual for a command', function (args, io) {
  if (!args[0]) { io.err('What manual page do you want?\nFor example, try \'man ls\'.\n'); return 1; }
  const c = COMMANDS[args[0]];
  if (!c) { io.err(`No manual entry for ${args[0]}\n`); return 16; }
  io.html(`<b>${escapeHTML(args[0].toUpperCase())}(1)</b>                IROS Manual\n\n<b>NAME</b>\n       ${escapeHTML(args[0])} - ${escapeHTML(c.help)}\n\n<b>SEE ALSO</b>\n       help(1)\n`);
});

cmd('ls', 'list directory contents (-l long, -a all)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  const all = flags.has('a'), long = flags.has('l');
  const targets = rest.length ? rest : ['.'];
  let status = 0;
  targets.forEach((t, idx) => {
    const p = this.abs(t), n = VFS.get(p);
    if (!n) { io.err(`ls: cannot access '${t}': No such file or directory\n`); status = 2; return; }
    if (targets.length > 1 && n.type === 'dir') io.out(`${idx ? '\n' : ''}${t}:\n`);
    let entries = n.type === 'dir' ? VFS.list(p, all).map(k => [k, VFS.get(VFS.join(p, k))]) : [[t, n]];
    if (all && n.type === 'dir') entries = [['.', n], ['..', VFS.get(dirname(p))], ...entries];
    if (long) {
      const u = this.env.USER;
      io.out(`total ${entries.length * 4}\n`);
      for (const [k, e] of entries) {
        const perms = e.type === 'dir' ? 'drwxr-xr-x' : /\.sh$/.test(k) ? '-rwxr-xr-x' : '-rw-r--r--';
        const size = e.type === 'dir' ? 4096 : e.content.length;
        io.html(`${perms} 1 ${escapeHTML(u)} ${escapeHTML(u)} ${String(size).padStart(7)} ${fmtLsDate(e.mtime)} ${colorName(k, e)}\n`);
      }
    } else if (entries.length) {
      io.html(entries.map(([k, e]) => colorName(k, e)).join('  ') + '\n');
    }
  });
  return status;
});

cmd('cd', 'change the working directory', function (args) {
  let t = args[0] || HOME;
  if (t === '-') t = this.env.OLDPWD || this.cwd;
  const p = this.abs(t);
  if (!VFS.exists(p)) throw new Error(`${t}: No such file or directory`);
  if (!VFS.isDir(p)) throw new Error(`${t}: Not a directory`);
  this.env.OLDPWD = this.cwd;
  this.cwd = this.env.PWD = p;
});

cmd('pwd', 'print the working directory', function (args, io) { io.out(this.cwd + '\n'); });

cmd(['cat', 'type'], 'print file contents (-n numbers lines)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  for (let text of this.readInputs(rest, io)) {
    if (text.startsWith('data:image')) { io.err('cat: binary image data not shown (open it in IR Paint)\n'); continue; }
    if (flags.has('n')) text = text.replace(/\n$/, '').split('\n').map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join('\n') + '\n';
    io.out(text);
  }
});

cmd('echo', 'display a line of text (-n no newline, -e escapes)', function (args, io) {
  const { flags } = parseFlags(args.filter(a => /^-[ne]+$/.test(a)));
  let s = args.filter(a => !/^-[ne]+$/.test(a)).join(' ');
  if (flags.has('e')) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  io.out(s + (flags.has('n') ? '' : '\n'));
});

cmd('mkdir', 'make directories (-p parents)', function (args) {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) throw new Error('missing operand');
  for (const d of rest) {
    try { VFS.mkdir(this.abs(d), flags.has('p')); }
    catch (e) { throw new Error(`cannot create directory '${d}': ${e.message}`); }
  }
});

cmd('touch', 'create empty files or update timestamps', function (args) {
  if (!args.length) throw new Error('missing file operand');
  for (const f of args) VFS.touch(this.abs(f));
});

cmd(['rm', 'del'], 'remove files (-r recursive, -f force)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  const rec = flags.has('r') || flags.has('R'), force = flags.has('f');
  if (!rest.length) throw new Error('missing operand');
  let status = 0;
  for (const f of rest) {
    const p = this.abs(f);
    if (p === '/') {
      io.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      status = 1; continue;
    }
    if (!VFS.exists(p)) { if (!force) { io.err(`rm: cannot remove '${f}': No such file or directory\n`); status = 1; } continue; }
    if (VFS.isDir(p) && !rec) { io.err(`rm: cannot remove '${f}': Is a directory\n`); status = 1; continue; }
    VFS.remove(p, true);
  }
  return status;
});

cmd('rmdir', 'remove empty directories', function (args) {
  for (const d of args) {
    try { VFS.rmdir(this.abs(d)); } catch (e) { throw new Error(`failed to remove '${d}': ${e.message}`); }
  }
});

cmd(['mv', 'move'], 'move or rename files', function (args) {
  const { rest } = parseFlags(args);
  if (rest.length < 2) throw new Error('missing destination file operand');
  const dst = rest.pop();
  if (rest.length > 1 && !VFS.isDir(this.abs(dst))) throw new Error(`target '${dst}' is not a directory`);
  for (const s of rest) {
    try { VFS.move(this.abs(s), this.abs(dst)); } catch (e) { throw new Error(`cannot move '${s}': ${e.message}`); }
  }
});

cmd(['cp', 'copy'], 'copy files and directories (-r)', function (args) {
  const { flags, rest } = parseFlags(args);
  if (rest.length < 2) throw new Error('missing destination file operand');
  const dst = rest.pop();
  for (const s of rest) {
    if (VFS.isDir(this.abs(s)) && !flags.has('r') && !flags.has('R')) throw new Error(`-r not specified; omitting directory '${s}'`);
    try { VFS.copy(this.abs(s), this.abs(dst)); } catch (e) { throw new Error(`cannot copy '${s}': ${e.message}`); }
  }
});

cmd('head', 'output the first lines (-n N)', function (args, io) {
  const { rest, n } = parseFlags(args);
  for (const t of this.readInputs(rest, io)) io.out(t.split('\n').slice(0, n ?? 10).join('\n').replace(/\n?$/, '\n'));
});

cmd('tail', 'output the last lines (-n N)', function (args, io) {
  const { rest, n } = parseFlags(args);
  for (const t of this.readInputs(rest, io)) {
    const lines = t.replace(/\n$/, '').split('\n');
    io.out(lines.slice(-(n ?? 10)).join('\n') + '\n');
  }
});

cmd('wc', 'count lines, words and bytes (-l -w -c)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  const texts = this.readInputs(rest, io);
  texts.forEach((t, i) => {
    const l = (t.match(/\n/g) || []).length, w = (t.match(/\S+/g) || []).length, c = t.length;
    const parts = flags.size ? [flags.has('l') && l, flags.has('w') && w, flags.has('c') && c].filter(x => x !== false) : [l, w, c];
    io.out(parts.map(x => String(x).padStart(flags.size === 1 ? 0 : 7)).join(' ') + (rest[i] ? ' ' + rest[i] : '') + '\n');
  });
});

cmd('sort', 'sort lines (-r reverse, -n numeric)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  let lines = this.readInputs(rest, io).join('').replace(/\n$/, '').split('\n');
  lines.sort(flags.has('n') ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => a.localeCompare(b));
  if (flags.has('r')) lines.reverse();
  if (flags.has('u')) lines = [...new Set(lines)];
  io.out(lines.join('\n') + '\n');
});

cmd('uniq', 'remove adjacent duplicate lines', function (args, io) {
  const lines = this.readInputs(args, io).join('').replace(/\n$/, '').split('\n');
  io.out(lines.filter((l, i) => l !== lines[i - 1]).join('\n') + '\n');
});

cmd('grep', 'search for a pattern (-i -n -v)', function (args, io) {
  const { flags, rest } = parseFlags(args);
  const pat = rest.shift();
  if (pat == null) { io.err('Usage: grep [OPTION]... PATTERNS [FILE]...\n'); return 2; }
  let re;
  try { re = new RegExp(pat, flags.has('i') ? 'gi' : 'g'); } catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.has('i') ? 'gi' : 'g'); }
  let found = false;
  const texts = this.readInputs(rest, io);
  texts.forEach((t, fi) => {
    t.replace(/\n$/, '').split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      const hit = re.test(line);
      if (hit === flags.has('v')) return;
      found = true;
      const prefix = (rest.length > 1 ? `<span class="t-mag">${escapeHTML(rest[fi])}</span>:` : '') + (flags.has('n') ? `<span class="t-exe">${i + 1}</span>:` : '');
      const body = flags.has('v') ? escapeHTML(line) : escapeHTML(line).replace(new RegExp(escapeHTML(re.source), re.flags), m => `<span class="t-err"><b>${m}</b></span>`);
      io.html(prefix + body + '\n');
    });
  });
  return found ? 0 : 1;
});

cmd('find', 'search for files (find [path] -name PATTERN)', function (args, io) {
  let start = '.', pat = null, type = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-name' || args[i] === '-iname') pat = args[++i];
    else if (args[i] === '-type') type = args[++i];
    else start = args[i];
  }
  const root = this.abs(start);
  if (!VFS.exists(root)) throw new Error(`'${start}': No such file or directory`);
  const re = pat ? new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
  VFS.walk(root, (p, n) => {
    if (re && !re.test(basename(p))) return;
    if (type && (type === 'd') !== (n.type === 'dir')) return;
    io.out((start === '.' ? '.' + p.slice(root.length) || '.' : p) + '\n');
  });
});

cmd('tree', 'list contents of directories in a tree', function (args, io) {
  const root = this.abs(args[0] || '.');
  if (!VFS.isDir(root)) throw new Error(`${args[0]}: No such directory`);
  let dirs = 0, files = 0;
  io.html(`<span class="t-dir">${escapeHTML(args[0] || '.')}</span>\n`);
  const rec = (p, prefix) => {
    const names = VFS.list(p);
    names.forEach((k, i) => {
      const last = i === names.length - 1, cp = VFS.join(p, k), n = VFS.get(cp);
      io.html(prefix + (last ? '└── ' : '├── ') + colorName(k, n) + '\n');
      if (n.type === 'dir') { dirs++; rec(cp, prefix + (last ? '    ' : '│   ')); } else files++;
    });
  };
  rec(root, '');
  io.out(`\n${dirs} directories, ${files} files\n`);
});

cmd('whoami', 'print the current user name', function (args, io) { io.out((this.root ? 'root' : this.env.USER) + '\n'); });
cmd('id', 'print user identity', function (args, io) {
  io.out(this.root ? 'uid=0(root) gid=0(root) groups=0(root)\n' : `uid=1000(${this.env.USER}) gid=1000(${this.env.USER}) groups=1000(${this.env.USER}),4(adm),27(sudo)\n`);
});
cmd('hostname', 'show the system host name', function (args, io) { io.out('iros\n'); });
cmd('uname', 'print system information (-a)', function (args, io) {
  io.out(args.includes('-a') ? 'Linux iros 6.8.0-iros #98-IROS SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux\n' : 'Linux\n');
});
cmd('lsb_release', 'print distribution information', function (args, io) {
  io.out(`Distributor ID:\tIROS\nDescription:\tIROS ${VERSION}\nRelease:\t98.04\nCodename:\traccoon\n`);
});
cmd('ver', 'show the IROS version', function (args, io) { io.out(`\nIROS [Version ${VERSION}]\n\n`); });
cmd('date', 'print the date and time', function (args, io) { io.out(new Date().toString().replace(/ \(.*\)$/, '') + '\n'); });
cmd('cal', 'display a calendar', function (args, io) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const title = d.toLocaleString('en', { month: 'long' }) + ' ' + y;
  let s = title.padStart(10 + title.length / 2).padEnd(20) + '\nSu Mo Tu We Th Fr Sa\n';
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let line = '   '.repeat(first);
  for (let i = 1; i <= days; i++) {
    const cell = String(i).padStart(2);
    line += (i === d.getDate() ? `<span class="t-inv">${cell}</span>` : cell) + ' ';
    if ((first + i) % 7 === 0) { s += line.trimEnd() + '\n'; line = ''; }
  }
  io.html(s + line + '\n');
});
cmd('uptime', 'tell how long the system has been running', function (args, io) {
  io.out(` ${new Date().toLocaleTimeString('en-GB')} up ${fmtUptime()},  1 user,  load average: 0.${Math.floor(Math.random() * 90 + 10)}, 0.42, 0.31\n`);
});
cmd('history', 'show command history (-c clears)', function (args, io) {
  if (args[0] === '-c') { this.history = []; Store.set('iros.history', []); return; }
  this.history.forEach((h, i) => io.out(`${String(i + 1).padStart(5)}  ${h}\n`));
});
cmd(['clear', 'cls'], 'clear the terminal screen', function () { this.clear(); });
cmd(['env', 'printenv'], 'print environment variables', function (args, io) {
  io.out(Object.entries({ ...this.env, PWD: this.cwd }).filter(([k]) => !/^\d+$/.test(k)).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
});
cmd('export', 'set an environment variable', function (args) {
  for (const a of args) { const i = a.indexOf('='); if (i > 0) this.env[a.slice(0, i)] = a.slice(i + 1); }
});
cmd('alias', 'define or list aliases', function (args, io) {
  if (!args.length) { for (const [k, v] of Object.entries(this.aliases)) io.out(`alias ${k}='${v}'\n`); return; }
  for (const a of args) {
    const i = a.indexOf('=');
    if (i > 0) this.aliases[a.slice(0, i)] = a.slice(i + 1);
    else if (this.aliases[a]) io.out(`alias ${a}='${this.aliases[a]}'\n`);
    else { io.err(`bash: alias: ${a}: not found\n`); return 1; }
  }
});
cmd('unalias', 'remove an alias', function (args) { for (const a of args) delete this.aliases[a]; });
cmd('which', 'locate a command', function (args, io) {
  let st = 0;
  for (const a of args) {
    if (this.aliases[a]) io.out(`${a}: aliased to \`${this.aliases[a]}'\n`);
    else if (COMMANDS[a] && (!COMMANDS[a].pkg || Packages.isInstalled(COMMANDS[a].pkg))) io.out(`/usr/bin/${a}\n`);
    else if (APP_ALIASES[a] && Packages.isInstalled(APP_ALIASES[a])) io.out(`/usr/bin/${a}\n`);
    else st = 1;
  }
  return st;
});
cmd('sleep', 'pause for N seconds', async function (args) {
  const end = Date.now() + (parseFloat(args[0]) || 0) * 1000;
  while (Date.now() < end && !this.abort) await sleep(50);
});
cmd('seq', 'print a sequence of numbers', function (args, io) {
  const n = args.map(Number);
  const [a, step, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
  const out = [];
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) { out.push(i); if (out.length > 10000) break; }
  io.out(out.join('\n') + '\n');
});
cmd(['true'], 'do nothing, successfully', () => 0);
cmd(['false'], 'do nothing, unsuccessfully', () => 1);
cmd(['exit', 'logout'], 'close the terminal', function () { this.win.close(); });
cmd(['bash', 'sh', 'source', '.'], 'run a shell script', async function (args) {
  if (!args[0]) throw new Error('interactive sub-shells are not supported; pass a script file');
  const p = this.abs(args[0]);
  if (!VFS.get(p)) throw new Error(`${args[0]}: No such file or directory`);
  return this.runScript(p, args.slice(1));
});
cmd(['nano', 'vi', 'vim', 'edit'], 'edit a file in the Text Editor', function (args, io, name) {
  if (name.startsWith('vi')) io.out('Opening the Text Editor instead. (Hint: you can always exit this one.)\n');
  const p = args[0] ? this.abs(args[0]) : null;
  launch('editor', p ? { path: VFS.exists(p) ? p : (VFS.write(p, ''), p) } : {});
});
cmd(['open', 'xdg-open', 'start'], 'open a file or folder with its default app', function (args) {
  const p = this.abs(args[0] || '.');
  if (!VFS.exists(p)) throw new Error(`${args[0]}: No such file or directory`);
  openPath(p);
});
cmd('notify-send', 'show a desktop notification', function (args) {
  UI.notify(args[0] || 'Notification', args.slice(1).join(' '), '💬');
});

cmd('sudo', 'run a command as the superuser', async function (args, io) {
  if (!args.length) { io.err('usage: sudo command\n'); return 1; }
  if (this.root) return this.exec(args, io);
  if (Date.now() > this.sudoUntil) {
    for (let tries = 0; ; tries++) {
      const pw = await this.readLine(`[sudo] password for ${this.env.USER}: `, true);
      if (pw === null) return 1;
      if (pw) break;
      if (tries === 2) { io.err('sudo: 3 incorrect password attempts\n'); return 1; }
      io.err('Sorry, try again.\n');
    }
    this.sudoUntil = Date.now() + 15 * 60000;
  }
  this.root = true;
  try { return await this.exec(args, io); } finally { this.root = false; }
});
cmd('su', 'switch user', function (args, io) { io.err('su: Authentication failure (try sudo instead)\n'); return 1; });

cmd(['ps'], 'report running processes', function (args, io) {
  io.out('    PID TTY          TIME CMD\n');
  for (const p of processList()) io.out(`${String(p.pid).padStart(7)} ${p.sys ? '?       ' : 'pts/0   '} 00:00:0${p.pid % 10} ${p.name}${p.title ? ' [' + p.title + ']' : ''}\n`);
});
cmd('top', 'show a snapshot of processes', function (args, io) {
  io.out(`top - ${new Date().toLocaleTimeString('en-GB')} up ${fmtUptime()},  1 user\nTasks: ${processList().length} total,   1 running\n%Cpu(s): ${(Math.random() * 20 + 3).toFixed(1)} us,  1.2 sy,  0.0 ni, 90.1 id\n\n    PID USER      %MEM COMMAND\n`);
  for (const p of processList()) io.out(`${String(p.pid).padStart(7)} ${p.user.padEnd(9)} ${(p.mem / 40.96).toFixed(1).padStart(4)} ${p.name}\n`);
  io.out('\n(Tip: install the "sysmon" package for a live graphical monitor.)\n');
});
cmd(['kill', 'killall', 'pkill'], 'terminate a process by PID or name', function (args, io, name) {
  const targets = args.filter(a => !a.startsWith('-'));
  if (!targets.length) { io.err(`${name}: usage: ${name} ${name === 'kill' ? 'PID' : 'NAME'}\n`); return 1; }
  let st = 0;
  for (const t of targets) {
    const procs = processList().filter(p => (name === 'kill' ? String(p.pid) === t : p.name === t));
    if (!procs.length) { io.err(name === 'kill' ? `kill: (${t}) - No such process\n` : `${name}: no process found\n`); st = 1; continue; }
    for (const p of procs) {
      if (p.sys) { io.err(`${name}: (${p.pid}) - Operation not permitted\n`); st = 1; }
      else p.win.close();
    }
  }
  return st;
});
cmd('free', 'display memory usage (-h)', function (args, io) {
  const used = 900 + WM.list().length * 40, total = 4096;
  io.out(`               total        used        free      shared  buff/cache   available\nMem:     ${String(total * 1024).padStart(12)}${String(used * 1024).padStart(12)}${String((total - used - 600) * 1024).padStart(12)}${'52480'.padStart(12)}${'614400'.padStart(12)}${String((total - used) * 1024).padStart(12)}\nSwap:    ${'2097152'.padStart(12)}${'0'.padStart(12)}${'2097152'.padStart(12)}\n`);
});
cmd('df', 'report file system disk space usage (-h)', function (args, io) {
  const used = VFS.size(), total = 5 * 1024 * 1024;
  io.out(`Filesystem      Size  Used Avail Use% Mounted on\n/dev/vfs0       5.0M ${(used / 1048576).toFixed(1).padStart(4)}M ${((total - used) / 1048576).toFixed(1).padStart(4)}M ${String(Math.ceil(used / total * 100)).padStart(3)}% /\ntmpfs           2.0G     0  2.0G   0% /dev/shm\n`);
});
cmd(['du'], 'estimate file space usage', function (args, io) {
  const p = this.abs(args.filter(a => !a.startsWith('-'))[0] || '.');
  io.out(`${Math.ceil(VFS.size(p) / 1024)}K\t${args.filter(a => !a.startsWith('-'))[0] || '.'}\n`);
});
cmd(['ifconfig', 'ip'], 'show network interfaces', function (args, io) {
  io.out('eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 192.168.98.4  netmask 255.255.255.0  broadcast 192.168.98.255\n        ether 08:00:27:98:04:1e  txqueuelen 1000  (Ethernet)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n');
});
cmd('ping', 'send ICMP echo requests to a host', async function (args, io) {
  const host = args.filter(a => !a.startsWith('-'))[0];
  if (!host) { io.err('ping: usage error: Destination address required\n'); return 1; }
  const ip = host === 'localhost' ? '127.0.0.1' : `93.184.${host.length * 7 % 255}.${host.charCodeAt(0) % 255}`;
  io.out(`PING ${host} (${ip}) 56(84) bytes of data.\n`);
  const times = [];
  for (let i = 1; i <= 4 && !this.abort; i++) {
    await sleep(600);
    const t = host === 'localhost' ? 0.04 + Math.random() * 0.03 : 12 + Math.random() * 20;
    times.push(t);
    io.out(`64 bytes from ${ip}: icmp_seq=${i} ttl=56 time=${t.toFixed(1)} ms\n`);
  }
  if (this.abort) io.out('^C\n');
  io.out(`\n--- ${host} ping statistics ---\n${times.length} packets transmitted, ${times.length} received, 0% packet loss\nrtt min/avg/max = ${Math.min(...times).toFixed(1)}/${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}/${Math.max(...times).toFixed(1)} ms\n`);
});
cmd(['theme'], 'change the desktop theme (classic, ubuntu, midnight)', function (args, io) {
  if (!THEMES[args[0]]) { io.out(`Current theme: ${Settings.get('theme')}\nAvailable: ${Object.keys(THEMES).join(', ')}\n`); return args[0] ? 1 : 0; }
  Settings.set('theme', args[0]);
});
cmd(['wallpaper'], 'change the desktop background', function (args, io) {
  if (!WALLPAPERS[args[0]] || args[0] === 'custom') {
    if (/^#[0-9a-f]{6}$/i.test(args[0] || '')) { Settings.set('customColor', args[0]); Settings.set('wallpaper', 'custom'); return; }
    io.out(`Available: ${Object.keys(WALLPAPERS).filter(k => k !== 'custom').join(', ')} or a color like #336699\n`);
    return args[0] ? 1 : 0;
  }
  Settings.set('wallpaper', args[0]);
});
cmd(['reboot'], 'restart the system', function () { System.shutdown('restart'); });
cmd(['shutdown', 'poweroff', 'halt'], 'power off the system', function () { System.shutdown('off'); });

// ---------- apt ----------
cmd(['apt', 'apt-get'], 'package manager (install, remove, list, search, update, upgrade, show)', async function (args, io) {
  const yes = args.includes('-y') || args.includes('--yes');
  const [sub, ...pkgs] = args.filter(a => !a.startsWith('-'));
  const root = ['install', 'remove', 'purge', 'update', 'upgrade', 'autoremove', 'full-upgrade'].includes(sub);
  const wait = ms => sleep(this.abort ? 0 : ms);
  if (!sub) {
    io.out('apt 2.7.14 (amd64)\nUsage: apt [options] command\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n');
    return 0;
  }
  if (root && !this.root) {
    io.err(`E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n`);
    return 100;
  }
  const progressBar = async label => {
    if (!io.live) return;
    const s = this.print('');
    for (let p = 0; p <= 100; p += 10 + Math.floor(Math.random() * 15)) {
      const n = Math.floor(p / 5);
      s.textContent = `${label}: [${String(p).padStart(3)}%] [${'#'.repeat(n)}${'.'.repeat(20 - n)}]`;
      await wait(70);
    }
    s.remove();
  };
  switch (sub) {
    case 'update': {
      const repos = ['retro InRelease', 'retro-updates InRelease', 'retro-security InRelease', 'retro-backports InRelease'];
      for (let i = 0; i < repos.length; i++) { await wait(250); io.out(`Hit:${i + 1} http://archive.iros.local/iros ${repos[i]}\n`); }
      await wait(200);
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nAll packages are up to date.\n');
      return 0;
    }
    case 'upgrade': case 'full-upgrade': case 'autoremove':
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nCalculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
      return 0;
    case 'list': {
      const only = args.includes('--installed');
      io.out('Listing... Done\n');
      for (const p of Packages.catalog) {
        const inst = Packages.isInstalled(p.id);
        if (only && !inst) continue;
        io.html(`<span class="t-exe">${p.id}</span>/retro ${p.version} amd64${inst ? ' [installed]' : ''}\n`);
      }
      return 0;
    }
    case 'search': {
      const q = (pkgs[0] || '').toLowerCase();
      io.out('Sorting... Done\nFull Text Search... Done\n');
      for (const p of Packages.catalog.filter(p => (p.id + p.desc).toLowerCase().includes(q))) {
        io.html(`<span class="t-exe">${p.id}</span>/retro ${p.version} amd64${Packages.isInstalled(p.id) ? ' [installed]' : ''}\n  ${escapeHTML(p.desc)}\n\n`);
      }
      return 0;
    }
    case 'show': {
      const p = Packages.find(pkgs[0]);
      if (!p) { io.err(`E: No packages found\n`); return 100; }
      io.out(`Package: ${p.id}\nVersion: ${p.version}\nPriority: optional\nSection: ${p.kind === 'app' ? 'x11' : 'utils'}\nMaintainer: IROS Developers <dev@iros.local>\nInstalled-Size: ${p.kb} kB\nDescription: ${p.desc}\n`);
      return 0;
    }
    case 'install': {
      io.out('Reading package lists... ');
      await wait(300);
      io.out('Done\nBuilding dependency tree... ');
      await wait(250);
      io.out('Done\nReading state information... Done\n');
      const fresh = [];
      for (const id of pkgs) {
        const p = Packages.find(id);
        if (!p) { io.err(`E: Unable to locate package ${id}\n`); return 100; }
        if (Packages.isInstalled(id)) io.out(`${id} is already the newest version (${p.version}).\n`);
        else if (!fresh.includes(p)) fresh.push(p);
      }
      if (!fresh.length) { io.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      const kb = fresh.reduce((s, p) => s + p.kb, 0);
      io.out(`The following NEW packages will be installed:\n  ${fresh.map(p => p.id).join(' ')}\n0 upgraded, ${fresh.length} newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${Math.round(kb * 0.4)} kB of archives.\nAfter this operation, ${kb} kB of additional disk space will be used.\n`);
      if (!yes) {
        const a = await this.readLine('Do you want to continue? [Y/n] ');
        if (a === null || /^n/i.test(a.trim())) { io.out('Abort.\n'); return 1; }
      }
      for (let i = 0; i < fresh.length; i++) {
        await wait(350);
        io.out(`Get:${i + 1} http://archive.iros.local/iros retro/main amd64 ${fresh[i].id} amd64 ${fresh[i].version} [${Math.round(fresh[i].kb * 0.4)} kB]\n`);
      }
      io.out(`Fetched ${Math.round(kb * 0.4)} kB in 1s (${Math.round(kb * 0.3)} kB/s)\n`);
      for (const p of fresh) {
        io.out(`Selecting previously unselected package ${p.id}.\n(Reading database ... ${1998 + Settings.get('installed').length * 37} files and directories currently installed.)\nPreparing to unpack .../${p.id}_${p.version}_amd64.deb ...\nUnpacking ${p.id} (${p.version}) ...\n`);
        await progressBar('Progress');
        Packages.install(p.id);
        io.out(`Setting up ${p.id} (${p.version}) ...\n`);
      }
      io.out('Processing triggers for man-db (2.12.0-4build2) ...\n');
      if (fresh.some(p => p.kind === 'app')) io.out('Processing triggers for desktop-file-utils (0.27-2build1) ...\n');
      UI.notify('Software installed', fresh.map(p => p.name).join(', '), '📦');
      return 0;
    }
    case 'remove': case 'purge': {
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      const gone = [];
      for (const id of pkgs) {
        if (APPS[id]?.builtin) { io.err(`E: ${id} is an essential package and cannot be removed\n`); return 100; }
        const p = Packages.find(id);
        if (!p) { io.err(`E: Unable to locate package ${id}\n`); return 100; }
        if (!Packages.isInstalled(id)) io.out(`Package '${id}' is not installed, so not removed\n`);
        else gone.push(p);
      }
      if (!gone.length) { io.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      io.out(`The following packages will be REMOVED:\n  ${gone.map(p => p.id).join(' ')}\n0 upgraded, 0 newly installed, ${gone.length} to remove and 0 not upgraded.\nAfter this operation, ${gone.reduce((s, p) => s + p.kb, 0)} kB disk space will be freed.\n`);
      if (!yes) {
        const a = await this.readLine('Do you want to continue? [Y/n] ');
        if (a === null || /^n/i.test(a.trim())) { io.out('Abort.\n'); return 1; }
      }
      for (const p of gone) {
        await wait(300);
        io.out(`Removing ${p.id} (${p.version}) ...\n`);
        Packages.remove(p.id);
      }
      io.out('Processing triggers for man-db (2.12.0-4build2) ...\n');
      return 0;
    }
    default:
      io.err(`E: Invalid operation ${sub}\n`);
      return 100;
  }
});
cmd('dpkg', 'list installed packages (-l)', function (args, io) {
  io.out('Desired=Unknown/Install/Remove/Purge/Hold\n||/ Name            Version      Description\n+++-===============-============-====================================\n');
  for (const a of Object.values(APPS).filter(a => a.builtin && !a.hidden)) io.out(`ii  ${('iros-' + a.id).padEnd(15)} ${'98.04'.padEnd(12)} ${a.name} (base system)\n`);
  for (const p of Packages.catalog.filter(p => Packages.isInstalled(p.id))) io.out(`ii  ${p.id.padEnd(15)} ${p.version.padEnd(12)} ${p.desc.slice(0, 40)}\n`);
});

// ---------- installable fun commands ----------
cmd('neofetch', 'show system information with a logo', function (args, io) {
  const logo = [
    '   _____  _____    ',
    '  |_   _||  __ \\   ',
    '    | |  | |__) |  ',
    '    | |  |  _  /   ',
    '   _| |_ | | \\ \\   ',
    '  |_____||_|  \\_\\  ',
    '                   ',
    '   ~ IROS 98.04 ~  ',
  ];
  const u = this.env.USER;
  const info = [
    `<span class="t-or"><b>${escapeHTML(u)}</b></span>@<span class="t-or"><b>iros</b></span>`,
    '-'.repeat(u.length + 5),
    ['OS', `IROS ${VERSION} x86_64`],
    ['Host', 'Browser Virtual Machine'],
    ['Kernel', '6.8.0-iros'],
    ['Uptime', fmtUptime()],
    ['Packages', `${Object.values(APPS).filter(a => a.builtin).length + Settings.get('installed').length} (apt)`],
    ['Shell', 'bash 5.2.21'],
    ['Resolution', `${screen.width}x${screen.height}`],
    ['DE', 'IROS Shell (classic + GNOME hybrid)'],
    ['Theme', THEMES[Settings.get('theme')]],
    ['Terminal', 'iros-terminal'],
    ['CPU', `Virtual x86_64 (${navigator.hardwareConcurrency || 4}) @ 2.98GHz`],
    ['Memory', `${900 + WM.list().length * 40}MiB / 4096MiB`],
    '',
    ['#000', '#c00', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf'].map(c => `<span style="background:${c}">   </span>`).join(''),
  ].map(x => (Array.isArray(x) ? `<span class="t-or"><b>${x[0]}</b></span>: ${escapeHTML(x[1])}` : x));
  let s = '';
  for (let i = 0; i < Math.max(logo.length, info.length); i++) {
    s += `<span class="t-or"><b>${escapeHTML(logo[i] || ' '.repeat(19))}</b></span>  ${info[i] || ''}\n`;
  }
  io.html(s);
}, 'neofetch');

cmd('cowsay', 'a talking cow', function (args, io) {
  const text = (args.join(' ') || (io.stdin ?? '').trim() || 'Moo!').replace(/\s+/g, ' ');
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 38) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  lines.push(cur);
  const W = Math.max(...lines.map(l => l.length));
  let s = ' ' + '_'.repeat(W + 2) + '\n';
  if (lines.length === 1) s += `< ${lines[0]} >\n`;
  else lines.forEach((l, i) => { const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|']; s += `${a} ${l.padEnd(W)} ${b}\n`; });
  s += ' ' + '-'.repeat(W + 2) + '\n';
  s += '        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n';
  io.out(s);
}, 'cowsay');

const FORTUNES = [
  'There are 10 kinds of people: those who understand binary and those who don\'t.',
  'It works on my machine. Ship the machine.',
  'A clean desktop is a sign of a full Trash.',
  'Never trust a computer you can\'t throw out a window.',
  'You will soon install a package you never use.',
  'The floppy disk is the true save icon. Respect your elders.',
  'Today\'s forecast: 100% chance of Ctrl+Z.',
  'To err is human; to really foul things up requires sudo.',
  'Simplicity is prerequisite for reliability.',
  'Your lucky numbers are 98, 04 and 127.0.0.1.',
  'Measure twice, rm -rf once. Better yet, use the Trash.',
  'Good code is its own best documentation, but write the docs anyway.',
  'Every great journey begins with "Hello, world!"',
  'The best time to make a backup was yesterday. The second best time is now.',
];
cmd('fortune', 'print a random adage', function (args, io) {
  io.out(FORTUNES[Math.floor(Math.random() * FORTUNES.length)] + '\n');
}, 'fortune');

cmd('sl', 'steam locomotive', async function (args, io) {
  const train = [
    '      ____                         ',
    '   __|[]|__________  ___________   ',
    '  |  IROS EXPRESS  ||  98.04    |  ',
    '  |________________||___________|  ',
    ' _/ (O)  (O)  (O)  \\/ (O)   (O) \\_ ',
  ];
  const smoke = ['   (  ) (@@) ( )  (@)  ()    @@    O     @', '  (@@@)  (    )   (@@@@)   (   )  @@  ()'];
  if (!io.live) return;
  const box = this.print('');
  const cols = this.cols(), width = train[0].length;
  for (let x = cols; x > -width - 10 && !this.closed; x -= 2) {
    const frame = [smoke[(x >> 2) & 1], ...train].map(line => {
      const padded = x >= 0 ? ' '.repeat(x) + line : line.slice(-x);
      return padded.slice(0, cols);
    });
    box.textContent = frame.join('\n') + '\n';
    await sleep(40);
  }
  box.remove();
}, 'sl');
