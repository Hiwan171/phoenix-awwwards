// Phoenix Ascension — the page. The world engine (engine/, from the Phoenix Ascension WebGL Experience) with OUR phoenix
// (rig controller, sleep / wake, wind, fire look, feet). Scroll drives the authored sequence (pure functions of time: reversible).
//   ?quality=ultra|high|medium|low   ?play=1 (plays by itself, no scroll)   ?hud=1   ?t=<seconds> (start time)
import Lenis from 'lenis';
import { Experience } from './engine/core/Experience.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const CHAPTERS = [['opening', 'Dusk'], ['awakening', 'Awakening'], ['takeoff', 'Ascent'], ['flight', 'Flight'], ['loop', 'Sovereign']];
$('chrow').innerHTML = CHAPTERS.map(([k, n]) => `<span data-k="${k}">${n}</span>`).join('');

function setChapter(ch) {
  const i = Math.max(0, CHAPTERS.findIndex(([k]) => k === ch));
  $('chi').textContent = 'Ch. ' + String(i + 1).padStart(2, '0');
  $('chn').textContent = CHAPTERS[i][1];
  [...$('chrow').children].forEach((el, j) => { el.className = j === i ? 'now' : j < i ? 'past' : ''; });
}

const exp = new Experience($('mount'), { quality: Q.get('quality') ?? 'auto' });
exp.on.progress = (p, label) => { $('lbar').style.width = Math.round(p * 100) + '%'; $('ltxt').textContent = `${label} · ${Math.round(p * 100)}%`; };
exp.on.chapter = setChapter;
if (Q.get('hud') === '1') { $('hud').style.display = 'block'; exp.on.stats = (s) => { $('hud').textContent = `${s.fps} fps  ${s.frameMs} ms\n${s.quality}  ${s.resolution}\nclouds ${s.cloudRes}\n${s.chapter} ${s.state} t ${s.time}`; }; }

try {
  await exp.init('/models/fenix-flight-web.glb');
} catch (e) {
  console.error(e);
  $('err').style.display = 'flex';
  $('errt').textContent = `${(e && e.message) || e}. This experience needs WebGL 2 with floating-point render targets.`;
  throw e;
}

// her plumage carries its own fire (fenix-look): the engine's flame tongues read as stickers on her; keep its embers.
if (Q.get('flames') !== '1') exp.setToggle('fire', false);

// scroll -> time. The timeline is not "seeked" (that would snap the camera and drop the clouds' temporal history every
// scroll event): its time is set directly, smoothed by Lenis, so the camera and the clouds keep their own smoothing.
const play = Q.get('play') === '1';
const lenis = new Lenis({ lerp: 0.075 });
const intro = exp.timeline.introDuration, tail = 26;                 // the sequence + one turn of the Sovereign loop
if (!play) exp.timeline.pause();
if (Q.has('t')) { exp.timeline.time = +Q.get('t'); if (!play) requestAnimationFrame(() => lenis.scrollTo((+Q.get('t') / (intro + tail)) * lenis.limit, { immediate: true })); }
exp.start();
function raf(now) {
  lenis.raf(now);
  if (!play) {
    const p = lenis.limit ? Math.min(1, Math.max(0, lenis.scroll / lenis.limit)) : 0;
    exp.timeline.time = p * (intro + tail);
  }
  $('prog').style.width = (Math.min(1, exp.timeline.time / (intro + tail)) * 100).toFixed(2) + '%';
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

$('loader').style.opacity = 0;
setTimeout(() => $('loader').remove(), 1300);
setTimeout(() => $('copy').classList.add('on'), 1600);
setTimeout(() => $('copy').classList.add('on2'), 2600);
// the title leaves as she wakes
const copyFade = () => { const t = exp.timeline.time; $('copy').style.opacity = t < 5 ? '' : String(Math.max(0, 1 - (t - 5) / 3)); requestAnimationFrame(copyFade); };
requestAnimationFrame(copyFade);

window.PHOENIX = { experience: exp, timeline: exp.timeline, lenis, setTime: (t) => { exp.timeline.time = t; lenis.scrollTo((t / (intro + tail)) * lenis.limit, { immediate: true }); }, ready: true };
