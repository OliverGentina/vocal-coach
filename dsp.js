/* Tonlabor DSP-Kern
   Verfahren (alle frei veröffentlicht):
   - Tonhöhe: YIN (de Cheveigné & Kawahara 2002)
   - Luftigkeit: Cepstral Peak Prominence (Hillenbrand et al. 1994), HNR
   - Gepresst/luftig: H1–H2 (Grundton vs. 2. Teilton), Alpha-Ratio (spektrale Neigung)
*/
const DSP = (function () {
  const NAMES = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'];
  const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);
  const hzToMidi = f => 69 + 12 * Math.log2(f / 440);
  const noteName = m => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
  const pc = m => NAMES[((Math.round(m) % 12) + 12) % 12];

  function median(a) { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
  function mean(a) { if (!a.length) return NaN; let s = 0; for (const v of a) s += v; return s / a.length; }
  function sd(a) { if (a.length < 2) return 0; const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / (a.length - 1)); }
  function percentile(a, p) { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }
  function linfit(xs, ys) { const n = xs.length; if (n < 2) return { a: ys[0] || 0, b: 0 }; const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const b = sxx > 1e-9 ? sxy / sxx : 0; return { a: my - b * mx, b }; }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, half = len >> 1;
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        for (let i = 0; i < n; i += len) {
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const hannCache = {};
  function hann(n) { if (!hannCache[n]) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); hannCache[n] = w; } return hannCache[n]; }

  // YIN auf x (Länge 2W). Liefert f0, Aperiodizität, normierte Autokorrelation.
  function yin(x, sr, fmin = 60, fmax = 1100, th = 0.15) {
    const W = x.length >> 1;
    const tauMin = Math.max(2, Math.floor(sr / fmax));
    const tauMax = Math.min(W - 2, Math.ceil(sr / fmin));
    const d = new Float64Array(tauMax + 2);
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
      d[tau] = s;
    }
    const dn = new Float64Array(tauMax + 2); dn[0] = 1; let run = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; dn[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (dn[t] < th) { while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    }
    if (tau < 0) { let best = Infinity; for (let t = tauMin; t <= tauMax; t++) if (dn[t] < best) { best = dn[t]; tau = t; } }
    let tp = tau;
    if (tau > 1 && tau < tauMax + 1) { const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1]; const den = a - 2 * b + c; if (Math.abs(den) > 1e-12) tp = tau + 0.5 * (a - c) / den; }
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < W; i++) { sxy += x[i] * x[i + tau]; sxx += x[i] * x[i]; syy += x[i + tau] * x[i + tau]; }
    const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    return { f0: sr / tp, ap: dn[tau], r };
  }

  // Spektrale Stimmklang-Merkmale auf Fenster x (Länge N, Zweierpotenz)
  function voiceQuality(x, sr, f0) {
    const N = x.length, w = hann(N);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[i] * w[i];
    fft(re, im);
    const half = N >> 1, P = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) P[k] = re[k] * re[k] + im[k] * im[k];
    const binHz = sr / N;
    const peakDb = f => { const lo = Math.max(1, Math.floor(Math.min(f * 0.9, f - 2 * binHz) / binHz)), hi = Math.min(half, Math.ceil(Math.max(f * 1.1, f + 2 * binHz) / binHz)); let m = 0; for (let k = lo; k <= hi; k++) if (P[k] > m) m = P[k]; return 10 * Math.log10(m + 1e-20); };
    const h1h2 = peakDb(f0) - peakDb(2 * f0);
    let lo = 0, hi = 0;
    for (let k = 0; k <= half; k++) { const f = k * binHz; if (f >= 50 && f < 1000) lo += P[k]; else if (f >= 1000 && f < 5000) hi += P[k]; }
    const alpha = 10 * Math.log10((hi + 1e-20) / (lo + 1e-20));
    // Cepstrum: Spektrum des log-Leistungsspektrums
    const cr = new Float64Array(N), ci = new Float64Array(N);
    for (let k = 0; k < N; k++) { const kk = k <= half ? k : N - k; cr[k] = 10 * Math.log10(P[kk] + 1e-20); }
    fft(cr, ci);
    const q0 = Math.round(0.001 * sr), q1 = Math.min(half - 1, Math.round(0.02 * sr));
    const C = new Float64Array(q1 + 1);
    for (let q = 0; q <= q1; q++) C[q] = 10 * Math.log10(cr[q] * cr[q] + ci[q] * ci[q] + 1e-20);
    const xs = [], ys = [];
    for (let q = q0; q <= q1; q++) { xs.push(q); ys.push(C[q]); }
    const fit = linfit(xs, ys);
    const pLo = Math.max(q0, Math.floor(sr / (f0 * 1.15))), pHi = Math.min(q1, Math.ceil(sr / (f0 * 0.87)));
    let pk = -1, pv = -Infinity;
    for (let q = pLo; q <= pHi; q++) if (C[q] > pv) { pv = C[q]; pk = q; }
    const cpp = pk > 0 ? pv - (fit.a + fit.b * pk) : NaN;
    return { h1h2, alpha, cpp };
  }

  // Analyse eines ganzen Signals → Frames
  function analyze(samples, sr, opts = {}) {
    const N = 4096, Y = 2048, hop = opts.hop || 1024;
    const fmin = opts.fmin || 60, fmax = opts.fmax || 1100;
    const frames = [];
    for (let pos = 0; pos + N <= samples.length; pos += hop) {
      const c = pos + (N >> 1);
      let s = 0, pk = 0;
      for (let i = c - 1024; i < c + 1024; i++) { const v = samples[i]; s += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
      frames.push({ t: c / sr, pos, db: 10 * Math.log10(s / 2048 + 1e-12), peak: pk, voiced: false });
    }
    if (!frames.length) return { frames, sr, gate: -60, clipped: false };
    const floor = percentile(frames.map(f => f.db), 0.1);
    const loud = percentile(frames.map(f => f.db), 0.95);
    const gate = Math.max(-62, Math.min(floor + 10, loud - 25));
    for (const f of frames) {
      if (f.db < gate) continue;
      const c = f.pos + (N >> 1);
      const y = yin(samples.subarray(c - (Y >> 1), c + (Y >> 1)), sr, fmin, fmax);
      if (y.ap > 0.4 || !(y.f0 >= fmin && y.f0 <= fmax)) continue;
      f.voiced = true; f.f0 = y.f0; f.midi = hzToMidi(y.f0); f.ap = y.ap;
      const r = Math.min(0.99999, Math.max(1e-5, y.r));
      f.hnr = 10 * Math.log10(r / (1 - r));
      Object.assign(f, voiceQuality(samples.subarray(f.pos, f.pos + N), sr, y.f0));
    }
    // Ausreißer glätten: Median über 5 Frames innerhalb stimmhafter Abschnitte
    const m = frames.map(f => f.voiced ? f.midi : null);
    for (let i = 0; i < frames.length; i++) {
      if (m[i] == null) continue;
      const nb = [];
      for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < frames.length && m[j] != null) nb.push(m[j]);
      if (nb.length >= 3) { const md = median(nb); if (Math.abs(m[i] - md) > 0.7) { frames[i].midi = md; frames[i].f0 = midiToHz(md); } }
    }
    // Einzelne stimmhafte Frames ohne Nachbarn verwerfen
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i].voiced) continue;
      const a = i > 0 && frames[i - 1].voiced, b = i < frames.length - 1 && frames[i + 1].voiced;
      if (!a && !b) frames[i].voiced = false;
    }
    return { frames, sr, gate, clipped: frames.some(f => f.peak > 0.985) };
  }

  // Standard-Basiswerte ohne Kalibrierung (grob, aus Tests mit Modellstimmen und Literaturwerten)
  const DEFAULT_BASE = { h1h2: 1, cpp: 22, hnr: 18, alpha: -12 };

  function baseline(calib, midi) {
    if (!calib || !calib.fit) return { ...DEFAULT_BASE, calibrated: false };
    const m = Math.min(calib.maxMidi + 3, Math.max(calib.minMidi - 3, midi));
    const out = { calibrated: true };
    for (const k of Object.keys(DEFAULT_BASE)) { const f = calib.fit[k]; out[k] = f ? f.a + f.b * m : DEFAULT_BASE[k]; }
    return out;
  }

  // Klangwert q: −1 = luftig … 0 = ausgewogen … +1 = gepresst
  function timbre(feat, midi, calib) {
    if (!feat || !isFinite(feat.cpp)) return null;
    const b = baseline(calib, midi);
    // Ohne Kalibrierung: saubere Aufnahme zählt nicht als „gepresst“; Alpha-Ratio (vokalabhängig) nur schwach
    const pos = v => b.calibrated ? v : Math.max(0, v);
    const breathy = pos((b.cpp - feat.cpp) / 3) + pos((b.hnr - feat.hnr) / 6) + (feat.h1h2 - b.h1h2) / 6;
    const pressed = (b.h1h2 - feat.h1h2) / 4 + (feat.alpha - b.alpha) / (b.calibrated ? 4 : 8);
    const q = Math.tanh((pressed - breathy) / 2);
    let label;
    if (q < -0.45) label = 'luftig'; else if (q < -0.2) label = 'leicht luftig'; else if (q <= 0.2) label = 'ausgewogen'; else if (q <= 0.45) label = 'leicht gepresst'; else label = 'gepresst';
    return { q, label, breathy, pressed, calibrated: b.calibrated };
  }

  // Bewertung gegen eine Lektion
  function evaluate(an, lesson, opts = {}) {
    const frames = an.frames;
    let map;
    if (opts.align === 'stretch') {
      const v = frames.filter((f, i) => f.voiced && frames[i + 1] && frames[i + 1].voiced && frames[i + 2] && frames[i + 2].voiced);
      if (v.length < 3) return { empty: true };
      const t0 = v[0].t, t1 = frames.filter(f => f.voiced).slice(-1)[0].t;
      const L0 = lesson.notes[0].start, L1 = lesson.total;
      const k = t1 > t0 ? (L1 - L0) / (t1 - t0) : 1;
      map = t => L0 + (t - t0) * k;
    } else { const off = opts.offset || 0; map = t => t - off; }
    for (const f of frames) f.tt = map(f.t);

    const notes = lesson.notes.map((n, idx) => {
      const ft = midiToHz(n.midi);
      const win = frames.filter(f => f.tt >= n.start && f.tt < n.start + n.dur);
      const sStart = n.start + Math.min(0.22, 0.3 * n.dur), sEnd = n.start + n.dur - 0.08 * n.dur;
      const steady = win.filter(f => f.voiced && f.tt >= sStart && f.tt <= sEnd);
      const voicedWin = win.filter(f => f.voiced);
      const res = { idx, midi: n.midi, name: noteName(n.midi), start: n.start, dur: n.dur, coverage: win.length ? voicedWin.length / win.length : 0 };
      if (steady.length < 2) { res.missing = true; res.score = 0; return res; }
      let cents = steady.map(f => 1200 * Math.log2(f.f0 / ft));
      let octave = 0;
      const m0 = median(cents);
      if (Math.abs(m0 - 1200) < 300) octave = 1; else if (Math.abs(m0 + 1200) < 300) octave = -1;
      if (octave) cents = cents.map(c => c - 1200 * octave);
      res.octave = octave;
      res.cents = median(cents);
      res.spread = sd(cents);
      res.hit = cents.filter(c => Math.abs(c) <= 25).length / cents.length;
      const att = voicedWin.find(f => Math.abs(1200 * Math.log2(f.f0 / ft) - 1200 * octave) <= 30);
      res.attack = att ? Math.max(0, att.tt - n.start) : null;
      const onset = voicedWin.filter(f => f.tt < (voicedWin[0] ? voicedWin[0].tt + 0.15 : 0)).map(f => 1200 * Math.log2(f.f0 / ft) - 1200 * octave);
      res.scoop = onset.length >= 2 && median(onset) < -60;
      res.db = median(steady.map(f => f.db));
      res.dbSpread = sd(steady.map(f => f.db));
      res.dbSlope = steady.length >= 4 ? linfit(steady.map(f => f.tt), steady.map(f => f.db)).b : 0;
      res.feat = { h1h2: median(steady.map(f => f.h1h2)), cpp: median(steady.map(f => f.cpp)), hnr: median(steady.map(f => f.hnr)), alpha: median(steady.map(f => f.alpha)) };
      res.timbre = timbre(res.feat, n.midi, opts.calib);
      const acc = Math.max(0, 100 - Math.max(0, Math.abs(res.cents) - 5) * 1.6);
      const stab = Math.max(0, 100 - Math.max(0, res.spread - 8) * 2.2);
      const atk = res.attack == null ? 0 : Math.max(0, 100 - Math.max(0, res.attack - 0.15) * 120);
      const cov = Math.min(1, res.coverage / 0.7);
      res.score = Math.round((0.6 * acc + 0.25 * stab + 0.15 * atk) * cov);
      return res;
    });
    const sung = notes.filter(n => !n.missing);
    const overall = {
      score: Math.round(mean(notes.map(n => n.score))),
      meanAbs: mean(sung.map(n => Math.abs(n.cents))),
      tendency: mean(sung.map(n => n.cents)),
      spread: mean(sung.map(n => n.spread)),
      db: median(sung.map(n => n.db)),
      dbSpread: mean(sung.map(n => n.dbSpread)),
      q: mean(sung.filter(n => n.timbre).map(n => n.timbre.q)),
      octave: sung.length && sung.every(n => n.octave === sung[0].octave) ? sung[0].octave : 0,
      missing: notes.length - sung.length,
      clipped: an.clipped
    };
    const curve = frames.filter(f => f.voiced).map(f => ({ t: f.tt, midi: f.midi - 12 * overall.octave, db: f.db }));
    return { notes, overall, curve, tips: tips(notes, overall, lesson) };
  }

  function tips(notes, o, lesson) {
    const out = [];
    const sung = notes.filter(n => !n.missing);
    if (!sung.length) return ['Ich habe keinen gesungenen Ton erkannt. Sing etwas lauter oder geh näher ans Mikrofon (etwa 20–30 cm).'];
    if (o.octave) out.push(`Du singst eine Oktave ${o.octave < 0 ? 'tiefer' : 'höher'} als die Vorgabe. Das ist okay, die Bewertung rechnet das heraus. Wähle sonst einen ${o.octave < 0 ? 'tieferen' : 'höheren'} Grundton.`);
    if (o.clipped) out.push('Die Aufnahme übersteuert. Geh etwas weiter weg vom Mikrofon.');
    else if (o.db < -42) out.push('Die Aufnahme ist sehr leise. Geh näher ans Mikrofon, damit die Klangwerte zuverlässig sind.');
    if (Math.abs(o.tendency) >= 15) out.push(`Insgesamt liegst du im Mittel ${Math.round(Math.abs(o.tendency))} Cent zu ${o.tendency < 0 ? 'tief' : 'hoch'}. ${o.tendency < 0 ? 'Denk den Ton von oben an und halte den Atemstrom aktiv.' : 'Lass den Ton eher sinken, nimm Druck raus.'}`);
    // Sprünge
    let upFlat = 0, ups = 0;
    for (let i = 1; i < sung.length; i++) { const d = sung[i].midi - sung[i - 1].midi; if (d >= 3) { ups++; if (sung[i].cents < -20) upFlat++; } }
    if (ups && upFlat / ups >= 0.5) out.push('Bei Sprüngen nach oben landest du oft zu tief. Hör den Zielton innerlich vor, bevor du springst.');
    const scoops = sung.filter(n => n.scoop).length;
    if (scoops >= Math.max(1, sung.length / 3)) out.push('Du schleifst Töne oft von unten an. Setz direkt auf der Tonhöhe ein, zum Beispiel mit einem leichten „ng“ davor.');
    const slow = sung.filter(n => n.attack != null && n.attack > 0.35).length;
    if (slow >= Math.max(1, sung.length / 3)) out.push('Du brauchst eine Weile, bis der Ton sitzt. Übe kurze, gezielte Einsätze auf einem Ton.');
    if (o.spread > 22) out.push('Die Töne schwanken recht stark. Halte lange Töne gerade, ohne Vibrato, und achte auf einen gleichmäßigen Atemstrom.');
    const falls = sung.filter(n => n.dbSlope < -5 && n.dur >= 1).length;
    if (falls >= Math.max(1, sung.length / 2)) out.push('Die Lautstärke fällt zum Tonende ab. Halte die Stütze bis zum Schluss.');
    if (o.dbSpread > 4) out.push('Die Lautstärke ist unruhig. Ziel: gleichmäßiger Pegel über den ganzen Ton.');
    if (isFinite(o.q)) {
      if (o.q < -0.35) out.push('Der Klang ist eher luftig. Schließ die Stimmlippen fester, zum Beispiel mit einem leichten „Ä“-Einsatz oder Übungen mit Strohhalm.');
      else if (o.q > 0.35) out.push('Der Klang wirkt eher gepresst. Nimm Druck raus: Gähnweite im Hals, weniger Lautstärke, lockerer Kiefer.');
      const hi = sung.filter(n => n.timbre && n.timbre.q > 0.35 && n.midi >= Math.max(...sung.map(s => s.midi)) - 2).length;
      if (o.q <= 0.35 && hi && sung.length >= 3) out.push('Bei den höchsten Tönen wird der Klang gepresster. Dort leichter werden, statt mehr zu drücken.');
    }
    if (!out.length) out.push('Sauber gesungen. Mach die Übung einen Halbton höher oder probier schwierigere Intervalle.');
    return out.slice(0, 5);
  }

  function calibrationFrom(result) {
    const sung = result.notes.filter(n => !n.missing && n.feat && isFinite(n.feat.cpp));
    if (sung.length < 3) return null;
    const xs = sung.map(n => n.midi), fit = {};
    const distinct = new Set(xs).size;
    for (const k of Object.keys(DEFAULT_BASE)) {
      const ys = sung.map(n => n.feat[k]);
      if (distinct >= 3) { const f = linfit(xs, ys); f.b = Math.max(-1.5, Math.min(1.5, f.b)); f.a = mean(ys) - f.b * mean(xs); fit[k] = f; }
      else fit[k] = { a: median(ys), b: 0 };
    }
    return { fit, minMidi: Math.min(...xs), maxMidi: Math.max(...xs), date: new Date().toISOString() };
  }

  // Modellstimme (Glottispuls + Formantfilter) für Beispiel und Tests
  function synthVoice({ sr = 48000, notes, mode = 'modal', cents = () => 0, lead = 0.4, seed = 7 }) {
    const total = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) + lead + 0.4;
    const len = Math.ceil(total * sr), out = new Float32Array(len);
    const P = { modal: { oq: 0.6, noise: 0.03 }, breathy: { oq: 0.85, noise: 0.22 }, pressed: { oq: 0.38, noise: 0.01 } }[mode];
    let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    const src = new Float64Array(len); let ph = 0, prev = 0;
    for (const n of notes) {
      const a = Math.floor((n.start + lead) * sr), b = Math.floor((n.start + lead + n.dur) * sr);
      for (let i = a; i < b && i < len; i++) {
        const t = (i - a) / sr;
        const f = midiToHz(n.midi) * Math.pow(2, (cents(n, t) + 6 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.6)) / 1200);
        ph += f / sr; if (ph >= 1) ph -= 1;
        const oq = P.oq, tp = 0.62 * oq;
        let g = ph < tp ? 0.5 * (1 - Math.cos(Math.PI * ph / tp)) : ph < oq ? Math.cos(Math.PI * (ph - tp) / (2 * (oq - tp))) : 0;
        const env = Math.min(1, t / 0.05) * Math.min(1, (b - i) / sr / 0.06);
        const dg = (g - prev) * sr / f; prev = g;
        src[i] += env * (dg + P.noise * 2.5 * rnd() * (0.4 + g));
      }
    }
    const F = [[700, 80], [1220, 90], [2600, 120], [3300, 180]];
    let x = src;
    for (const [fc, bw] of F) {
      const r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * fc / sr;
      const a1 = -2 * r * Math.cos(th), a2 = r * r, g = 1 + a1 + a2;
      const y = new Float64Array(len);
      for (let i = 0; i < len; i++) y[i] = g * x[i] - a1 * (i > 0 ? y[i - 1] : 0) - a2 * (i > 1 ? y[i - 2] : 0);
      x = y;
    }
    let mx = 0; for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(x[i]));
    for (let i = 0; i < len; i++) out[i] = 0.5 * x[i] / (mx || 1) + 0.0008 * rnd();
    return out;
  }

  return { NAMES, midiToHz, hzToMidi, noteName, pc, yin, analyze, evaluate, timbre, calibrationFrom, synthVoice, median, DEFAULT_BASE };
})();
if (typeof module !== 'undefined') module.exports = DSP;
