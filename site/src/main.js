// Hero only: loader -> ash vortex -> silhouette -> ember dissolve -> ignition.
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
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = Q.get('lite') === '1' || innerWidth < 760 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4;
const $ = (s, r = document) => r.querySelector(s);
gsap.ticker.lagSmoothing(0);                                         // the intro is wall-clock timed: never stretch it on slow frames

// state read by the stage every frame (all of it driven by the intro timeline)
const S = { form: 0, reveal: 0, ignite: 0, idle: 0, ashFade: 1, dolly: 1.5, punch: 0, bloom: 0,
            camR: 2.5, camY: 0.1, orbit: 0, hover: 0 };

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
const chars = split(titleEl);
gsap.set(chars, { yPercent: 115, opacity: 0 });
gsap.set(lede, { opacity: 0, y: 18 });

function revealTitle() {
  if (reduced || QA) { gsap.set(chars, { yPercent: 0, opacity: 1 }); gsap.set(lede, { opacity: 1, y: 0 }); return; }
  gsap.to(chars, { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.022 });
  gsap.to(lede, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 0.45 });
}

// ───────── intro (time-based) ─────────
function buildIntro(onDone) {
  const t = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
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
async function boot() {
  const root = document.documentElement;
  const loader = $('#loader'), bar = $('#loader-bar'), count = $('#loader-count');
  let target = 0, shown = 0;
  const loadTick = () => { shown += (target - shown) * 0.12; bar.style.width = `${shown * 100}%`; count.textContent = String(Math.round(shown * 100)).padStart(3, '0'); };
  gsap.ticker.add(loadTick);
  if (!QA) root.classList.add('is-intro');

  let stage;
  const started = performance.now();
  try {
    stage = await createStage({ canvas: $('#gl'), lite, reduced, onProgress: (f) => { target = Math.max(target, f * 0.92); } });
  } catch (err) {
    console.error('WebGL unavailable', err);
    root.classList.add('no-gl'); root.classList.remove('is-intro');
    gsap.ticker.remove(loadTick);
    loader.remove();
    revealTitle();
    return;
  }
  target = 1;
  await new Promise((r) => setTimeout(r, Math.max(0, (QA ? 0 : 1300) - (performance.now() - started))));
  while (shown < 0.985 && !QA) await new Promise((r) => setTimeout(r, 40));
  gsap.ticker.remove(loadTick);
  bar.style.width = '100%'; count.textContent = '100';

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  addEventListener('resize', () => stage.resize());

  gsap.ticker.add((_, deltaMs) => stage.frame(Math.min(0.05, deltaMs / 1000), S, pointer));

  const intro = buildIntro(() => root.classList.remove('is-intro'));
  if (QA) {
    loader.remove();
    intro.progress(Q.has('intro') ? parseFloat(Q.get('intro')) : 1);
    root.classList.remove('is-intro');
  } else if (reduced) {
    loader.remove(); intro.progress(1); root.classList.remove('is-intro');
  } else {
    // the loader hands over to the vortex: ember flares, overlay dissolves, intro starts underneath
    gsap.timeline()
      .to('.loader__ember', { scale: 14, opacity: 0, duration: 0.8, ease: 'power3.out' })
      .to(loader, { opacity: 0, duration: 0.8, ease: 'power3.inOut', onComplete: () => loader.remove() }, 0.1)
      .add(() => intro.play(0), 0.05);
  }

  window.__phoenix = { S, intro, stage, ready: true };
}

boot();
