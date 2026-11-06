const D = require('./dsp.js');
const sr = 48000;
const steps = [0, 2, 4, 5, 7, 5, 4, 2, 0];
const lesson = { notes: steps.map((s, i) => ({ midi: 50 + s, start: i * 0.8, dur: 0.8 })) };
lesson.total = lesson.notes.length * 0.8;
const single = { notes: [{ midi: 52, start: 0, dur: 3 }], total: 3 };

function run(mode, lessonX, cents, calib, align = 'timed') {
  const x = D.synthVoice({ sr, notes: lessonX.notes, mode, cents, lead: 0.4 });
  const t = Date.now();
  const an = D.analyze(x, sr);
  const r = D.evaluate(an, lessonX, { offset: 0.4, calib, align });
  return { r, ms: Date.now() - t };
}
for (const mode of ['breathy', 'modal', 'pressed']) {
  const { r, ms } = run(mode, single, () => 0);
  const n = r.notes[0];
  console.log(mode.padEnd(8), 'ms', ms, 'cents', n.cents.toFixed(1), 'feat', Object.entries(n.feat).map(([k, v]) => k + '=' + v.toFixed(1)).join(' '), '→', n.timbre.label, n.timbre.q.toFixed(2));
}
// Pitch accuracy test: −20 cents, octave check, stretch alignment
let { r } = run('modal', lesson, () => -20);
console.log('scale -20c:', r.notes.map(n => n.cents.toFixed(0)).join(','), 'score', r.overall.score, 'tend', r.overall.tendency.toFixed(1));
console.log('tips', r.tips);
// calibration from modal scale then test breathy/pressed relative
const cal = D.calibrationFrom(run('modal', lesson, () => 0).r);
console.log('calib', JSON.stringify(cal.fit));
for (const mode of ['breathy', 'modal', 'pressed']) {
  const { r } = run(mode, lesson, () => 0, cal);
  console.log('cal', mode, r.notes.map(n => n.timbre.label).join(' | '), 'q', r.overall.q.toFixed(2));
}
// octave lower singing
const low = { notes: lesson.notes.map(n => ({ ...n, midi: n.midi - 12 })), total: lesson.total };
const x = D.synthVoice({ sr, notes: low.notes, mode: 'modal', lead: 0.4 });
const r2 = D.evaluate(D.analyze(x, sr), lesson, { offset: 0.4 });
console.log('octave', r2.overall.octave, r2.notes.map(n => n.cents.toFixed(0)).join(','));
// stretch: sung slower (1.0s per note) uploaded, start at 1.2s
const slow = { notes: lesson.notes.map((n, i) => ({ midi: n.midi, start: i * 1.0, dur: 1.0 })) };
const xs = D.synthVoice({ sr, notes: slow.notes, mode: 'modal', lead: 1.2, cents: (n, t) => (t < 0.12 ? -90 : 10) });
const r3 = D.evaluate(D.analyze(xs, sr), lesson, { align: 'stretch' });
console.log('stretch', r3.notes.map(n => n.cents.toFixed(0) + (n.scoop ? 's' : '')).join(','), r3.overall.score, r3.tips);
