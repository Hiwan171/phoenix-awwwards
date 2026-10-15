// Hero (15/10/2026): the dusk sky shader full screen, and the phoenix hovering in the middle of it, beating her wings in
// place. No opening transition, no loader, no copy, no HUD yet: the world is being built piece by piece.
// (The ember/ash intro is archived in site/_archive/intro-ember, the scroll/acts version in site/_archive/scroll-slice.)
import './style.css';
import gsap from 'gsap';
import { createStage } from './stage.js';
import { addPhoenix } from './hero-fenix.js';
import { installInspect } from './hero-inspect.js';

const Q = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = Q.get('lite') === '1' || innerWidth < 760 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4;

// view state read by the stage every frame (framing + QA overrides: t camR camX camY camLook auraI auraRim auraOpaque skyYaw skyPitch)
// She is centred: the stage's default framing leaves room for copy on the right (camX 0.42); the hero has no copy yet.
const S = { camX: 0, camR: 3.1, camY: 0.12, camLook: 0.02 };
for (const k of ['camX', 'camR', 'camY', 'camLook']) if (Q.has(k)) S[k] = +Q.get(k);
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = -((e.clientY / innerHeight) * 2 - 1); }, { passive: true });

async function boot() {
  let stage;
  try { stage = createStage({ canvas: document.getElementById('gl'), lite, reduced }); }
  catch (err) { console.error('WebGL unavailable', err); document.documentElement.classList.add('no-gl'); return; }
  addEventListener('resize', () => stage.resize());

  // programs are compiled against the real targets BEFORE the first visible frame, so the sky appears finished (no hitch)
  try { await stage.load(); }
  catch (err) { console.error('stage failed to load', err); document.documentElement.classList.add('no-gl'); return; }

  let phoenix = null;
  try { phoenix = await addPhoenix(stage, { lite, reduced }); }
  catch (err) { console.error('phoenix failed to load, showing the bare sky', err); }

  const inspect = phoenix ? installInspect({ canvas: document.getElementById('gl'), phoenix, stage, S }) : null;

  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((_, deltaMs) => {
    const dt = Math.min(0.05, deltaMs / 1000);
    inspect?.update(dt);                              // turn / tilt from the mouse (see hero-inspect.js)
    phoenix?.update(dt, S.t ?? null);                 // S.t freezes the clock for QA: the beat becomes a pure function of it
    stage.frame(dt, S, pointer);
  });
  window.__phoenix = { S, stage, phoenix, inspect, ready: true };       // QA hook (tools/*.mjs wait for it)
}

boot();
