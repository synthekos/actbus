// scheduler.js — v1.3.0 · triggers: scripts run on a schedule an administrator wrote · changelog: act/CHANGELOG.md#actschedulerjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ## Design
// TRIGGERS for PROTEUS-K scripts, in the kernel (slice 3: ACTBUS docs/capability-architecture.md §7 item 3)
// Scripts run on their own, on a schedule an ADMIN wrote: act/actions/triggers.spec.json, read at start (no editing in the browser).
//   { "triggers": [ { "id": "thought-hourly", "script": "thought-mail", "runsAs": "helper-thoughts", "every": 3600 },
//                   { "id": "thought-1815", "script": "thought-mail", "runsAs": "helper-thoughts", "at": "18:15", "tz": "America/Toronto",
//                     "days": "mon-fri", "missed": "skip", "input": {} } ] }
// Rules:
//   · a fire is an ordinary message: bus.ask(runsAs, script, input) — the runsAs identity must hold the script (the bus checks, audits);
//   · every ≥ 60 s (≤ 31 days); at most 20 triggers; a bad entry is refused (the others load) and named in refused[];
//   · no overlap: if a trigger's previous run is still going, the new fire is skipped and audited;
//   · missed runs (box off or asleep): "skip" (default) or "run-late" (once, never once per missed period);
//   · a per-identity cap on fires per hour (default 60);
//   · `at` uses the box clock and Intl time zones: a daylight-saving jump fires once, never twice; a time that does not exist that
//     day (spring forward) fires at the first minute after it;
//   · state (last fire per trigger, triggers switched off, the ids loaded at this start) lives in <stateDir>/scheduler.json (temp
//     file + rename) and survives restarts; act.js passes stateDir <appDir>/act-files/.scheduler, which no identity's file folder can
//     reach. act.js consumes each file in .scheduler/off/ at the next tick: "switched off" is kept here, not in off/;
//   · 1.3.0: at every start the ids it loaded (refused entries are not among them) are written to the state as loaded.ids, so
//     act/trigger-off.js can refuse an id this scheduler does not run, and refuse when there is no state at all;
//   · a trigger can be SWITCHED OFF without editing the file (free); it comes back ON only when its entry in the file changes (an
//     admin edits the file) — a hijacked admin page can stop schedules, never start them.
// new Scheduler({ bus, spec, stateDir, clock, audit, perHour, graceMs, retryMs }) · .tick() (called every 15 s by start(); tests call it)
// · .status() · .switchOff(id, by) · .stop()
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const MAX_TRIGGERS = 20, MIN_EVERY = 60, MAX_EVERY = 31 * 86400;
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function parseDays(d) {
  if (d === undefined || d === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (d === 'mon-fri') return [1, 2, 3, 4, 5];
  if (d === 'sat-sun') return [0, 6];
  if (typeof d !== 'string') throw new Error('days must be daily, mon-fri, sat-sun or a list like "mon,wed"');
  const out = d.split(',').map((x) => DAYS[x.trim()]);
  if (!out.length || out.some((x) => x === undefined)) throw new Error('days must be daily, mon-fri, sat-sun or a list like "mon,wed"');
  return [...new Set(out)].sort();
}
// the wall-clock parts of an instant in a time zone
const FMT = new Map();                                             // one formatter per zone (building one is the slow part)
function wall(ms, tz) {
  let f = FMT.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short' }); FMT.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: DAYS[p.weekday.toLowerCase().slice(0, 3)] };
}
// the FIRST instant (minute resolution) on local date y-mo-d whose wall time is ≥ hh:mm in tz — DST-safe: a repeated hour picks the
// first occurrence, a missing hour picks the first minute after it. null if the date has no such minute.
function firstAtOrAfter(y, mo, d, hh, mm, tz) {
  // a plain minute-by-minute scan over the ±16 h around the naive UTC guess (every zone offset is within ±14 h): simple, and correct
  // where wall time jumps back (fall-back: the FIRST occurrence wins) or forward (spring-forward: the first minute after the gap)
  const key = (w) => ((w.y * 100 + w.mo) * 100 + w.d) * 10000 + w.h * 100 + w.mi;
  const target = ((y * 100 + mo) * 100 + d) * 10000 + hh * 100 + mm;
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  for (let t = guess - 16 * 3600000; t <= guess + 16 * 3600000; t += 60000) {
    const w = wall(t, tz);
    if (key(w) >= target) return (w.y === y && w.mo === mo && w.d === d) ? t : null;
  }
  return null;
}
// the next fire of an `at` trigger strictly after `after` (ms)
function nextAt(t, after) {
  const [hh, mm] = t.at.split(':').map(Number);
  const w0 = wall(after, t.tz);                                       // 1.0.1 (M3): walk LOCAL dates, never +24 h steps
  for (let i = 0; i <= 8; i++) {
    const c = new Date(Date.UTC(w0.y, w0.mo - 1, w0.d + i)), w = { y: c.getUTCFullYear(), mo: c.getUTCMonth() + 1, d: c.getUTCDate(), wd: c.getUTCDay() };
    if (!t.daySet.includes(w.wd)) continue;
    const at = firstAtOrAfter(w.y, w.mo, w.d, hh, mm, t.tz);
    if (at !== null && at > after) return at;
  }
  return null;
}

function validate(list) {
  const ok = [], refused = [], ids = new Set();
  if (!Array.isArray(list)) return { ok, refused: [{ id: '(file)', reason: 'triggers must be a list' }] };
  for (const [i, raw] of list.entries()) {
    const id = raw && typeof raw.id === 'string' ? raw.id : '(entry ' + (i + 1) + ')';
    try {
      if (!raw || typeof raw !== 'object') throw new Error('an entry must be an object');
      for (const k of Object.keys(raw)) if (!['id', 'script', 'runsAs', 'every', 'at', 'tz', 'days', 'missed', 'input', 'on', 'topic'].includes(k)) throw new Error('unknown field ' + k);
      if (!NAME.test(raw.id || '')) throw new Error('id must be a name (a-z, 0-9, -)');
      if (ids.has(raw.id)) throw new Error('id used twice');
      if (!NAME.test(raw.script || '')) throw new Error('script must be a name');
      if (!NAME.test(raw.runsAs || '')) throw new Error('runsAs must be a name');
      if ([raw.every, raw.at, raw.on].filter((x) => x !== undefined).length !== 1) throw new Error('give exactly one of every, at or on');
      if (raw.on !== undefined && raw.on !== 'message') throw new Error('on must be "message"');
      if ((raw.on !== undefined) !== (raw.topic !== undefined)) throw new Error('on: "message" needs a topic (and topic goes only with on)');
      if (raw.topic !== undefined && !NAME.test(raw.topic)) throw new Error('topic must be a name (a-z, 0-9, -)');
      if (raw.every !== undefined && !(Number.isInteger(raw.every) && raw.every >= MIN_EVERY && raw.every <= MAX_EVERY)) throw new Error('every must be ' + MIN_EVERY + '–' + MAX_EVERY + ' seconds');
      const t = { ...raw, missed: raw.missed || 'skip', input: raw.input || {}, sha: sha(raw) };
      if (!['skip', 'run-late'].includes(t.missed)) throw new Error('missed must be skip or run-late');
      if (typeof t.input !== 'object' || Array.isArray(t.input)) throw new Error('input must be an object');
      if (raw.at !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.at)) throw new Error('at must be HH:MM (24-hour)');
        if (typeof raw.tz !== 'string') throw new Error('at needs tz, e.g. America/Toronto');
        try { new Intl.DateTimeFormat('en-US', { timeZone: raw.tz }); } catch { throw new Error('unknown time zone ' + raw.tz); }
        t.daySet = parseDays(raw.days);
      } else if (raw.tz !== undefined || raw.days !== undefined) throw new Error('tz and days go with at, not every or on');
      if (ok.length >= MAX_TRIGGERS) throw new Error('more than ' + MAX_TRIGGERS + ' triggers');
      ids.add(raw.id); ok.push(Object.freeze(t));
    } catch (e) { refused.push({ id, reason: e.message }); }
  }
  return { ok, refused };
}

class Scheduler {
  constructor({ bus, spec, stateDir, clock = Date.now, audit = () => {}, perHour = 60, graceMs = 120000, pending = null, retryMs = [5000, 30000] }) {
    Object.assign(this, { bus, stateDir, clock, audit, perHour, graceMs, pending, retryMs });   // 1.1.0: pending(identity, topic) → waiting messages
    this.retry = new Map();                                         // 1.2.0: trigger id → { at, firedAt, used: { normal, evict } } — the retries of a transient refusal
    this.capLog = new Map();
    const v = validate(spec && spec.triggers);
    this.triggers = v.ok; this.refused = v.refused;
    for (const r of v.refused) this.log('refused', { id: r.id, reason: r.reason });
    this.file = stateDir ? path.join(stateDir, 'scheduler.json') : null;
    this.state = this.load();
    this.running = new Set(); this.fires = new Map(); this.next = new Map(); this.timer = null;
    const now = this.clock();
    for (const t of this.triggers) {
      const off = this.state.off[t.id];
      if (off && off !== t.sha) { delete this.state.off[t.id]; this.log('switched-on', { id: t.id, by: 'the triggers file changed' }); }
      const last = this.state.last[t.id];
      const f = this.state.first[t.id];   // 1.0.1: an `every` grid starts when the trigger (this version of its entry) is first seen
      if (t.every && !last && !(f && f.sha === t.sha)) this.state.first[t.id] = { at: now, sha: t.sha };
      if (t.on) { this.next.set(t.id, null); continue; }              // 1.1.0: a message trigger has no time
      this.next.set(t.id, last ? this.after(t, last) : t.every ? this.after(t, this.state.first[t.id].at) : this.after(t, now));
    }
    this.state.loaded = { at: new Date(now).toISOString(), ids: this.triggers.map((t) => t.id) };   // 1.3.0: read by trigger-off.js
    this.save();
  }
  log(kind, rec) { try { this.audit({ kind: 'trigger-' + kind, ...rec }); } catch { /* best effort */ } }
  load() {
    const bare = (o) => Object.assign(Object.create(null), o || {});   // 1.0.1 (L2): no inherited keys ("constructor", "toString" …)
    const empty = { v: 1, last: bare(), off: bare(), first: bare() };
    if (!this.file || !fs.existsSync(this.file)) return empty;
    try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (s && s.v === 1 && s.last && s.off) return { v: 1, last: bare(s.last), off: bare(s.off), first: bare(s.first) }; } catch { /* below */ }
    throw new Error('scheduler state ' + this.file + ' is corrupt — refusing to start the scheduler (no silent reset)');
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  after(t, ms) { return t.every ? ms + t.every * 1000 : nextAt(t, ms); }
  status() {
    return this.triggers.map((t) => ({ id: t.id, script: t.script, runsAs: t.runsAs, every: t.every, at: t.at, tz: t.tz, days: t.days,
      missed: t.missed, msg: t.on === 'message' ? t.topic : undefined, on: !this.state.off[t.id], running: this.running.has(t.id), last: this.state.last[t.id] || null, next: this.next.get(t.id) || null }));
  }
  switchOff(id, by = 'admin') {
    const t = this.triggers.find((x) => x.id === id); if (!t) return false;
    this.state.off[id] = t.sha; this.save(); this.log('switched-off', { id, by }); return true;
  }
  capped(identity, now) {
    const w = (this.fires.get(identity) || []).filter((x) => now - x < 3600000);
    this.fires.set(identity, w);
    return w.length >= this.perHour;
  }
  tick() {
    const now = this.clock(), fired = [];
    for (const t of this.triggers) {
      let missed = false, retryOf = null;
      if (t.on) {                                                    // 1.1.0: fires when its identity has waiting messages on its topic
        if (this.state.off[t.id] || this.running.has(t.id) || typeof this.pending !== 'function') continue;
        let n = 0; try { n = this.pending(t.runsAs, t.topic); } catch (e) { this.log('skip', { id: t.id, why: 'mailbox: ' + String(e.message).slice(0, 100) }); continue; }
        if (!(n > 0)) continue;
        if (this.capped(t.runsAs, now)) { if (now - (this.capLog.get(t.id) || 0) > 3600000) { this.capLog.set(t.id, now); this.log('skip', { id: t.id, why: t.runsAs + ' reached ' + this.perHour + ' fires this hour (' + n + ' waiting)' }); } continue; }
      } else {
      const rt = this.retry.get(t.id);
      if (rt && now >= rt.at && !this.running.has(t.id)) {           // 1.2.0: the one retry of a transiently refused fire
        this.retry.delete(t.id);
        if (this.state.off[t.id]) { this.log('skip', { id: t.id, why: 'switched off (its retry is dropped)' }); continue; }
        retryOf = rt;
      } else {
      const due = this.next.get(t.id);
      if (due === null || due === undefined || now < due) continue;
      if (this.retry.delete(t.id)) this.log('skip', { id: t.id, why: 'a new fire is due — it replaces the pending retry' });
      missed = now - due > this.graceMs;
      // the next one is always computed from NOW: missed periods collapse into one decision, never a burst
      this.next.set(t.id, this.after(t, t.every ? Math.max(due, now - (now - due) % (t.every * 1000)) : now));
      if (this.state.off[t.id]) { this.log('skip', { id: t.id, why: 'switched off' }); continue; }
      if (missed && t.missed === 'skip') { this.log('skip', { id: t.id, why: 'missed (due ' + new Date(due).toISOString() + ')' }); continue; }
      }
      }
      if (this.running.has(t.id)) { this.log('skip', { id: t.id, why: 'its previous run is still going' }); continue; }
      if (this.capped(t.runsAs, now)) { this.log('skip', { id: t.id, why: t.runsAs + ' reached ' + this.perHour + ' fires this hour' }); continue; }
      this.fires.get(t.runsAs).push(now);
      this.running.add(t.id); if (!retryOf) { this.state.last[t.id] = now; this.save(); }   // 1.2.0: a retry is the same fire — `last` stays the period's time
      this.log('fire', { id: t.id, script: t.script, runsAs: t.runsAs, late: missed, ...(retryOf ? { retry: true } : {}) });
      fired.push(Promise.resolve().then(() => this.bus.ask(t.runsAs, t.script, t.input, { labels: [] }))
        .then((r) => {
          const transient = !!(r && !r.ok && r.transient === true);
          this.log('done', { id: t.id, ok: !!(r && r.ok), code: r && r.code, ...(transient ? { transient: true } : {}), labels: r && r.labels });
          if (!transient || t.on) return;                            // 1.2.0: a message trigger fires again by itself (its messages wait)
          const n = retryOf ? retryOf.n : 0, extra = !!(retryOf && retryOf.extra);   // retries made for this fire · the one extra try used?
          let wait = null, next = { n, extra };
          if (n < this.retryMs.length) { wait = this.retryMs[n]; next.n = n + 1; }                 // the ladder: 5 s, then 30 s
          else if (r.code === 'DAEMON_EVICTING' && !extra) { wait = this.retryMs[0]; next.extra = true; }   // a slot is being freed: never the last word
          if (wait === null) { this.log('lost', { id: t.id, code: r.code, why: 'refused again before it could run (' + r.code + ') — this fire is lost' }); return; }
          const at = this.clock() + wait;
          this.retry.set(t.id, { at, firedAt: retryOf ? retryOf.firedAt : now, ...next });
          this.log('retry-later', { id: t.id, code: r.code, at: new Date(at).toISOString(), try: next.n + (next.extra ? 2 : 1) });
        },
          (e) => this.log('done', { id: t.id, ok: false, code: 'ERROR', error: String((e && e.message) || e).slice(0, 200) }))
        .finally(() => this.running.delete(t.id)));
    }
    return Promise.all(fired);
  }
  start(everyMs = 15000) { if (!this.timer) { this.timer = setInterval(() => this.tick(), everyMs); this.timer.unref(); } return this; }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { Scheduler, validate, nextAt, firstAtOrAfter, wall };
