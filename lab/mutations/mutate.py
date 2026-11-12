#!/usr/bin/env python3
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# mutate.py — v1.2.2 (111126: kernel 0.54.3 — M14's first anchor follows bus 1.6.0, the same mutation) · v1.2.1 (091126: names neutral; every mutation unchanged) · v1.2.0 (071126: ACTBUS repo, kernel 0.53.5-headers — M13's error-path anchor follows bus 1.4.6) · v1.1.0 (061126: kernel 0.53.2 — M3 + str/join (second reader, 11:45), + M15 (the build session, bus 1.4.5)) · v1.0.1 (061126: M13/M14 anchored on the success path's unique '  ]);' + clearTimeout — v1.0.0's anchor occurred twice and was refused) · The second reader's sealed mutations M1–M14 (mutations/SEALED-LIST_061126.md, list sha256 42e73dce…6d74).
# Each mutation = exact text replacements in a COPY of the lab kernel; every old text must occur exactly once (else: refuse, mapping wrong).
# usage: mutate.py <kernel-dir> <out-dir> <Mi>      (prints the mapping; never touches the source kernel)
import sys, os, shutil
RUNLINE_OLD = "    try { this.audit({ ...base, outcome: 'run', input: JSON.stringify(env.action === 'email' ? mailInput(env.input) : env.action === 'send' ? sendInput(env.input) : env.input).slice(0, 300) }); }\n    catch (e) { return { ok: false, id: env.id, trace: env.trace, action: env.action, code: ERR.AUDIT, error: 'audit log unwritable — nothing was run (' + e.message + ')' }; }"
RUNLINE_NEW = "    const __runLine = () => { try { this.audit({ ...base, outcome: 'run', input: JSON.stringify(env.action === 'email' ? mailInput(env.input) : env.action === 'send' ? sendInput(env.input) : env.input).slice(0, 300) }); } catch (_) {} };   // M13"
M = {
 'M1': ('fetch host check matches by substring', [('act/actions/fetch.js', "if (!targets.includes(want))", "if (!targets.some((t) => want.includes(t)))")]),
 'M2': ('fetch follows redirects', [('act/actions/fetch.js', "redirect: 'manual'", "redirect: 'follow'")]),
 'M3': ('trim/upper/lower, replace, str and join return clean labels', [
     ('act/proteus/eval.js', "return V('str', cap(h === 'upper' ? t.toUpperCase() : h === 'lower' ? t.toLowerCase() : t.trim()), COMP);", "return V('str', cap(h === 'upper' ? t.toUpperCase() : h === 'lower' ? t.toLowerCase() : t.trim()), new Set(['computed']));"),
     ('act/proteus/eval.js', "return V('str', cap(parts.join(xs[2].v)), COMP);", "return V('str', cap(parts.join(xs[2].v)), new Set(['computed']));"),
     ('act/proteus/eval.js', "return V('str', s, noCred(D));                                   // F-B round 3: joined text is new text", "return V('str', s, new Set(['computed']));   // M3 (str)"),
     ('act/proteus/eval.js', "return V('str', cap(t), noCred(union(D, ...xs[0].v.map((i) => i.L))));", "return V('str', cap(t), new Set(['computed']));   // M3 (join)")]),
 'M4': ('parse-json result carries control labels only', [('act/proteus/eval.js', "return fromJSON(j, union(D, ['computed']), n);", "return fromJSON(j, union(C, ['computed']), n);")]),
 'M5': ('mailbox read: sender labels not restored', [
     ('act/core/bus.js', "for (const r of got) for (const l of r.labels || []) if (env_.LABELS.includes(l) && !isCred(l)) received.add(l);", "/* M5 */"),
     ('act/core/bus.js', "labels: [...new Set((labels || []).filter((l) => env_.LABELS.includes(l) && !isCred(l)))].sort() }));", "labels: [] }));")]),
 'M6': ('grounded not dropped in transit', [
     ('act/mailbox.js', "labels.filter((l) => LABELS.includes(l) && !CRED.includes(l))", "labels.filter((l) => LABELS.includes(l))"),
     ('act/core/bus.js', "for (const r of got) for (const l of r.labels || []) if (env_.LABELS.includes(l) && !isCred(l)) received.add(l);", "for (const r of got) for (const l of r.labels || []) if (env_.LABELS.includes(l)) received.add(l);"),
     ('act/core/bus.js', "labels: [...new Set((labels || []).filter((l) => env_.LABELS.includes(l) && !isCred(l)))].sort() }));", "labels: [...new Set((labels || []).filter((l) => env_.LABELS.includes(l)))].sort() }));")]),
 'M7': ('file without sidecar reads clean', [('act/actions/file.js', "ctx.addLabels(readLabels(side) || ['web']);", "ctx.addLabels(readLabels(side) || []);")]),
 'M8': ('remembered values return clean', [('act/proteus/eval.js', "return s ? dec(s.value, new Set(s.labels))", "return s ? dec(s.value, new Set(['computed']))")]),
 'M9': ('acceptWarnings ignored', [('act/core/registry.js', "if (warnings.length && e.acceptWarnings !== true)", "if (false && warnings.length && e.acceptWarnings !== true)")]),
 'M10': ('strictControl does nothing', [('act/core/bus.js', "const ctlTaint = grant.strictControl ? env_.tainted(env.ctl || []) : [];", "const ctlTaint = [];")]),
 'M11': ('chain uses only the callee grant', [('act/core/capabilities.js', "  for (const name of chain) {", "  for (const name of chain.slice(-1)) {")]),
 'M12': ('rate limit keyed by trace', [
     ('act/core/bus.js', "win = (this.rates.get(env.from) || []).filter((x) => t - x < 60000);", "win = (this.rates.get(env.trace) || []).filter((x) => t - x < 60000);"),
     ('act/core/bus.js', "win.push(t); this.rates.set(env.from, win);", "win.push(t); this.rates.set(env.trace, win);")]),
 'M13': ('audit run line written after the run', [
     ('act/core/bus.js', RUNLINE_OLD, RUNLINE_NEW),
     ('act/core/bus.js', "      ]);\n      clearTimeout(timer);\n", "      ]);\n      clearTimeout(timer); __runLine();\n"),
     ('act/core/bus.js', "      clearTimeout(timer);\n      const transient = ", "      clearTimeout(timer); __runLine();\n      const transient = ")]),   # 1.2.0: bus 1.4.6 (0.53.4) put the transient check here
 'M15': ('the kernel target check removed — bus 1.4.5 only (added by the build session)', [
     ('act/core/bus.js', "    if (tj) return this.refuse(env, tj.code === 'BAD_INPUT' ? ERR.BAD_INPUT : ERR.NO_TARGET, tj.reason);", "    /* M15 */")]),
 'M14': ('dedupe remembers only successes', [
     ('act/core/bus.js', "    mine.set(env.id, now);\n", "    // M14: not remembered here\n"),
     ('act/core/bus.js', "      ]);\n      clearTimeout(timer);\n", "      ]);\n      clearTimeout(timer); mine.set(env.id, now);\n")]),
}
if __name__ == '__main__':
    kdir, out, mi = sys.argv[1:4]
    if mi == 'list':
        for k, (what, reps) in M.items():
            print(k + ' — ' + what); [print('    ' + f + ': «' + o.strip()[:110] + '» → «' + n.strip()[:110] + '»') for f, o, n in reps]
        sys.exit(0)
    if os.path.exists(out): shutil.rmtree(out)
    shutil.copytree(kdir, out)
    what, reps = M[mi]
    for f, o, n in reps:
        p = os.path.join(out, f); s = open(p).read(); c = s.count(o)
        if c != 1: sys.exit('REFUSED ' + mi + ': ' + f + ' has ' + str(c) + ' copies of «' + o[:80] + '»')
        open(p, 'w').write(s.replace(o, n))
    print(mi + ' applied: ' + what)
