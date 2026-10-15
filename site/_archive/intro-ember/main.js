// Hero only: the ember is the seed. Loading progress is drawn IN the scene (ash born around the ember),
// then ash vortex -> silhouette -> ember dissolve -> ignition. Skippable (Esc / click / Space / Enter).
// (The scroll/acts version is archived in site/_archive/scroll-slice.)
import './style.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource-variable/inter';
import gsap from 'gsap';
import { createStage } from './stage.js';

const Q = new URLSearchParams(location.search);
const QA = Q.has('intro') || Q.has('p');                              // ?intro=0.4 freezes the intro for QA screenshots
const QA_BIRTH = Q.has('birth');                                      // ?birth=0.4 freezes the loading phase (ember + ash being born)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = Q.get('lite') === '1' || innerWidth < 760 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4;
const $ = (s, r = document) => r.querySelector(s);
gsap.ticker.lagSmoothing(0);                                         // the intro is wall-clock timed: never stretch it on slow frames

// state read by the stage every frame (all of it driven by the intro timeline)
const S = { form: 0, reveal: 0, ignite: 0, idle: 0, ashFade: 1, dolly: 1.5, punch: 0, bloom: 0,
            camR: 2.8, camY: 0.1, orbit: 0, hover: 0,
            birth: 0, ember: 1, flare: 0 };                        // loading phase: ash born from the ember

// ───────── text splitting (chars inside nowrap words; keeps <em> and <br>) ─────────
function split(el) {
  const chars = [];
  const walk = (node, parent) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach((tok) => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) { parent.append(' '); return; }
          const w = document.createElement('span'); w.className = 'line-mask'; w.style.whiteSpace = 'nowrap';
          [...tok].forEach((c) => { const s = document.createElement('span'); s.className = 'char'; s.textContent = c; w.append(s); chars.push(s); });
          parent.append(w);
        });
      } else if (n.nodeName === 'BR') parent.append(document.createElement('br'));
      else { const c = n.cloneNode(false); parent.append(c); walk(n, c); }
    });
  };
  const label = el.textContent.replace(/\s+/g, ' ').trim();
  const clone = el.cloneNode(false); walk(el, clone);
  el.replaceChildren(...clone.childNodes);
  el.setAttribute('aria-label', label);
  el.querySelectorAll('.line-mask').forEach((w) => w.setAttribute('aria-hidden', 'true'));
  return chars;
}
const titleEl = $('[data-split]');
const lede = $('[data-fade]');
const kicker = $('.kicker');
const chars = split(titleEl);
gsap.set(chars, { yPercent: 115, opacity: 0 });
gsap.set(lede, { opacity: 0, y: 18 });
gsap.set(kicker, { opacity: 0 });

function revealTitle() {
  if (reduced || QA) { gsap.set(chars, { yPercent: 0, opacity: 1 }); gsap.set(lede, { opacity: 1, y: 0 }); gsap.set(kicker, { opacity: 1 }); return; }
  gsap.to(kicker, { opacity: 1, duration: 0.9, ease: 'power2.out' });
  gsap.to(chars, { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.022 });
  gsap.to(lede, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 0.45 });
}

// ───────── intro (time-based) ─────────
function buildIntro(onDone) {
  const t = gsap.timeline({ paused: true, defaults: { ease: 'none' } }).timeScale(INTRO_SPEED);
  t.to(S, { dolly: 0, duration: 4.2, ease: 'power3.out' }, 0)
   .to(S, { form: 1, duration: 2.1, ease: 'power2.inOut' }, 0)
   .add(revealTitle, 0.9)
   .to(S, { reveal: 1, duration: 1.5, ease: 'power2.inOut' }, 1.7)
   .to(S, { ashFade: 0, duration: 0.8, ease: 'power1.in' }, 2.6)
   .to(S, { ignite: 1, duration: 1.4, ease: 'power2.inOut' }, 2.6)
   .to(S, { idle: 1, duration: 0.9, ease: 'power1.inOut' }, 2.8)
   // the moment the fire catches: white flash + a camera punch-in that settles back
   .to(S, { bloom: 0.95, duration: 0.22, ease: 'power3.out' }, 2.75)
   .to(S, { bloom: 0, duration: 1.2, ease: 'power2.inOut' }, 2.97)
   .to(S, { punch: -0.22, duration: 0.22, ease: 'power3.out' }, 2.75)
   .to(S, { punch: 0, duration: 1.1, ease: 'power2.out' }, 2.97)
   .add(onDone, 4.0);
  return t;
}

// ───────── boot ─────────
const BIRTH_MS = 1400;           // the cloud takes at least this long to be born, even from a warm cache
const HANDOFF_AT = 0.8;          // the intro starts underneath the last 20 % of the birth
const INTRO_SPEED = 1.2;         // the tuned 4.0 s intro, played 20 % faster so loading + intro fits ~4 s

async function boot() {
  const root = document.documentElement;
  const loader = $('#loader'), bar = $('#loader-bar'), count = $('#loader-count'), skipBtn = $('#intro-skip');
  const setCount = (f) => { bar.style.width = `${f * 100}%`; count.textContent = String(Math.round(f * 100)).padStart(3, '0'); };
  const failToStatic = (err) => {
    console.error('WebGL unavailable', err);
    root.classList.add('no-gl'); root.classList.remove('is-intro');
    loader.remove(); skipBtn?.remove();
    revealTitle();
  };
  if (!QA) root.classList.add('is-intro');
  if (QA) { S.birth = 1; S.ember = 0; }

  let stage;
  try { stage = createStage({ canvas: $('#gl'), lite, reduced }); } catch (err) { return failToStatic(err); }

  // QA: freeze the loading phase at a given birth value
  if (QA_BIRTH) {
    S.birth = Math.min(1, Math.max(0, parseFloat(Q.get('birth')) || 0));
    S.dolly = 1.5 + (1 - S.birth) * 0.35;
    setCount(S.birth);
    gsap.ticker.add((_, deltaMs) => stage.frame(Math.min(0.05, deltaMs / 1000), S, { x: 0, y: 0 }));
    addEventListener('resize', () => stage.resize());
    window.__phoenix = { S, stage, ready: true };
    return;
  }

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  addEventListener('resize', () => stage.resize());
  gsap.ticker.add((_, deltaMs) => stage.frame(Math.min(0.05, deltaMs / 1000), S, pointer));

  // the ember is on screen from frame 1; progress = min(time ramp, real download) so it never jumps
  const started = performance.now();
  let real = 0, shown = 0, intro = null, skipped = false;
  const loadTick = () => {
    const el = performance.now() - started;
    const ramp = Math.min(1, el / BIRTH_MS);
    const cap = stage.loaded ? 1 : Math.max(0.2 + 0.7 * real, 0.7 * (1 - Math.exp(-el / 2000)));   // indeterminate downloads still creep
    shown += (Math.min(ramp, cap) - shown) * 0.14;
    S.birth = shown;
    S.dolly = 1.5 + (1 - shown) * 0.35;                    // a slow push-in while the cloud is born
    setCount(shown);
  };
  if (!QA) gsap.ticker.add(loadTick);

  // skip: fast-forward whatever phase we are in
  const onSkip = (e) => {
    if (e.type === 'keydown' && !['Escape', ' ', 'Enter'].includes(e.key)) return;
    if (!root.classList.contains('is-intro') || skipped) return;
    skipped = true;
    if (intro) gsap.to(intro, { timeScale: 8, duration: 0.25, ease: 'power2.in' });
  };
  addEventListener('keydown', onSkip);
  addEventListener('pointerdown', onSkip);
  skipBtn?.addEventListener('click', onSkip);

  try {
    await stage.load((f) => { if (f >= 0) real = Math.max(real, f); });
  } catch (err) {
    gsap.ticker.remove(loadTick);
    return failToStatic(err);
  }
  real = 1;

  intro = buildIntro(() => { root.classList.remove('is-intro'); skipBtn?.remove(); });
  if (QA || reduced) {
    gsap.ticker.remove(loadTick);
    S.birth = 1; S.ember = 0;
    loader.remove(); skipBtn?.remove();
    intro.progress(QA && Q.has('intro') ? parseFloat(Q.get('intro')) : 1);
    root.classList.remove('is-intro');
  } else {
    // wait until the ember has thrown most of the cloud (or skip was pressed), then hand over
    while (!skipped && shown < HANDOFF_AT) await new Promise((r) => setTimeout(r, 30));
    gsap.ticker.remove(loadTick);
    setCount(1);
    gsap.timeline()
      .to(S, { birth: 1, duration: 0.5, ease: 'power1.out' }, 0)
      .to(S, { flare: 1, duration: 0.9, ease: 'power3.out' }, 0)          // the ember flares as the vortex starts
      .to(S, { ember: 0, duration: 0.8, ease: 'power2.in' }, 0.1)
      .to(loader, { opacity: 0, duration: 0.6, ease: 'power2.inOut', onComplete: () => loader.remove() }, 0.1)
      .add(() => { intro.play(0); if (skipped) intro.timeScale(8); }, 0);
  }

  window.__phoenix = { S, intro, stage, ready: true };
}

boot();
