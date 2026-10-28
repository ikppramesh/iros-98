'use strict';

// ---- Shared helpers, settings, events and sound ----

const HOME = '/home/user';
const TRASH = HOME + '/.local/share/Trash';
const BOOT_TIME = Date.now();
const VERSION = '98.10 LTS';
const CODENAME = 'Retro Raccoon';

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function basename(p) { return p.split('/').filter(Boolean).pop() || '/'; }
function dirname(p) { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function prettyPath(p) { return p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p; }
function fmtSize(n) {
  if (n < 1024) return n + ' bytes';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fmtUptime() {
  const s = Math.floor((Date.now() - BOOT_TIME) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h} hour${h > 1 ? 's' : ''}, ${m} min` : `${m} min${m === 1 ? '' : 's'}`;
}

const Bus = {
  handlers: {},
  on(evt, fn) {
    (this.handlers[evt] ||= new Set()).add(fn);
    return () => this.handlers[evt].delete(fn);
  },
  emit(evt, data) { for (const fn of [...(this.handlers[evt] || [])]) fn(data); },
};

const Store = {
  get(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  },
  clear() {
    try { Object.keys(localStorage).filter(k => k.startsWith('iros.')).forEach(k => localStorage.removeItem(k)); } catch { }
  },
};

const Settings = {
  defaults: { username: 'user', theme: 'classic', wallpaper: 'teal', customColor: '#3a6ea5', sound: true, installed: [] },
  data: null,
  load() { this.data = { ...this.defaults, ...Store.get('iros.settings', {}) }; },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; Store.set('iros.settings', this.data); Bus.emit('settings', k); },
};

// Deterministic star field so the "Starry Night" wallpaper looks the same every load.
const STARS = (() => {
  let seed = 98;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 60 }, () =>
    `radial-gradient(${rnd() < 0.2 ? 2 : 1}px ${rnd() < 0.2 ? 2 : 1}px at ${(rnd() * 100).toFixed(1)}% ${(rnd() * 100).toFixed(1)}%, #fff, transparent)`
  ).join(', ');
})();

const WALLPAPERS = {
  teal: { name: 'Classic Teal', css: '#008080' },
  aubergine: { name: 'Aubergine', css: 'radial-gradient(ellipse at 15% 0%, #f07a3c 0%, #e95420 12%, #a0306a 40%, #4a0f3a 72%, #2c001e 100%)' },
  clouds: {
    name: 'Clouds',
    css: 'radial-gradient(ellipse 140px 50px at 20% 28%, #fff 40%, transparent 70%), radial-gradient(ellipse 200px 70px at 68% 18%, #fff 40%, transparent 70%), radial-gradient(ellipse 170px 55px at 52% 62%, #ffffffee 40%, transparent 70%), radial-gradient(ellipse 120px 45px at 14% 76%, #ffffffdd 40%, transparent 70%), radial-gradient(ellipse 150px 50px at 86% 82%, #ffffffdd 40%, transparent 70%), linear-gradient(#2a6fd6, #9cc8f5)',
  },
  hills: { name: 'Green Hills', css: 'radial-gradient(ellipse 70% 40% at 20% 100%, #3c8d2f 60%, transparent 61%), radial-gradient(ellipse 80% 45% at 85% 100%, #4fa83d 60%, transparent 61%), radial-gradient(circle 40px at 82% 18%, #fff7b0 50%, transparent 52%), linear-gradient(#5fa8ff, #cfe8ff)' },
  night: { name: 'Starry Night', css: STARS + ', linear-gradient(#000016, #1b1b4b)' },
  sunset: { name: 'Sunset', css: 'radial-gradient(circle 70px at 50% 72%, #ffe9a8 50%, transparent 52%), linear-gradient(#2b1055 0%, #7b2869 35%, #e95420 70%, #ffb347 100%)' },
  custom: { name: 'Solid Color', css: null },
};

const THEMES = {
  classic: 'IROS Classic (98)',
  ubuntu: 'Aubergine (Ubuntu-style)',
  midnight: 'Midnight (Dark)',
};

const Sound = {
  ctx: null,
  tone(freq, dur, when = 0, type = 'sine', vol = 0.06) {
    if (!Settings.get('sound')) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      const t = c.currentTime + when;
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch { }
  },
  startup() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 1.4, i * 0.16, 'triangle', 0.05)); },
  shutdown() { [1046.5, 783.99, 659.25, 523.25, 392].forEach((f, i) => this.tone(f, 1.2, i * 0.18, 'triangle', 0.05)); },
  ding() { this.tone(880, 0.25, 0, 'square', 0.03); this.tone(660, 0.35, 0.09, 'square', 0.025); },
  pop() { this.tone(1200, 0.08, 0, 'sine', 0.04); },
};
