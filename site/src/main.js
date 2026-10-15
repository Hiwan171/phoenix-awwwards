// Hero: the dusk sky with the phoenix in front of it. Loads behind an opaque cover, then shows the final state
// (no opening sequence for now: the ember/ash intro was archived in site/_archive/intro-ember while it is redesigned).
// (The scroll/acts version is archived in site/_archive/scroll-slice.)
import './style.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource-variable/inter';
import gsap from 'gsap';
import { createStage } from './stage.js';

const Q = new URLSearchParams(location.search);
const QA = Q.has('intro') || Q.has('p') || Q.has('qa');               // QA / screenshots: no cover, no fade
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = Q.get('lite') === '1' || innerWidth < 760 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4;
const $ = (s, r = document) => r.querySelector(s);

// view state read by the stage every frame (framing + QA overrides: camR camX camLook camLookP camPushP auraI auraRim auraOpaque hover)
const S = {};

async function boot() {
  const root = document.documentElement;
  const loader = $('#loader'), bar = $('#loader-bar'), count = $('#loader-count');
  const setCount = (f) => { bar.style.width = `${f * 100}%`; count.textContent = String(Math.round(f * 100)).padStart(3, '0'); };
  const failToStatic = (err) => {
    console.error('WebGL unavailable', err);
    root.classList.add('no-gl'); root.classList.remove('is-intro');
    loader.remove();
  };
  if (!QA) root.classList.add('is-intro');                            // hides the HUD until the scene is ready

  let stage;
  try { stage = createStage({ canvas: $('#gl'), lite, reduced }); } catch (err) { return failToStatic(err); }

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  addEventListener('resize', () => stage.resize());
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((_, deltaMs) => stage.frame(Math.min(0.05, deltaMs / 1000), S, pointer));

  // progress: the real download, eased so the counter never jumps; the last stretch (bake + compile) creeps toward 99
  let real = 0, shown = 0;
  const started = performance.now();
  const tick = () => {
    const creep = 0.9 + 0.09 * (1 - Math.exp(-(performance.now() - started) / 4000));
    const target = stage.loaded ? 1 : Math.min(creep, 0.05 + 0.85 * real + 0.1 * (real >= 1 ? 1 : 0));
    shown += (target - shown) * 0.12;
    setCount(shown);
  };
  gsap.ticker.add(tick);

  try {
    await stage.load((f) => { if (f >= 0) real = Math.max(real, f); });
  } catch (err) {
    gsap.ticker.remove(tick);
    return failToStatic(err);
  }
  gsap.ticker.remove(tick);
  setCount(1);

  window.__phoenix = { S, stage, ready: true };

  // show: a plain cross-fade from the cover (placeholder until the opening is redesigned)
  if (QA || reduced) { loader.remove(); root.classList.remove('is-intro'); return; }
  gsap.to(loader, { opacity: 0, duration: 0.9, ease: 'power2.inOut', delay: 0.15, onComplete: () => loader.remove() });
  setTimeout(() => root.classList.remove('is-intro'), 450);
}

boot();
