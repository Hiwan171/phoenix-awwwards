// Inspection controls of the hero (to study the phoenix's motion): turn her, zoom, slow down, pause, see the skeleton.
// There is no on-screen text: the page must stay clean for screen recordings.
//   drag            turn her (yaw) and tilt her (pitch), with a little inertia
//   wheel / pinch   zoom                 double click / R   reset the view
//   ← →  ↑ ↓        turn / tilt in steps
//   1 / 2 / 3       beat at 25 % / 50 % / 100 % speed      Space   pause / resume (you can still turn her)
//   B               show / hide the skeleton (bones through the mesh)
import * as THREE from 'three';

export function installInspect({ canvas, phoenix, stage, S }) {
  const view = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, camR: S.camR };
  let dragging = false, lx = 0, ly = 0, lastSpeed = 1;
  const pinch = new Map();
  let pinchDist = 0;

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    pinch.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
    dragging = true; lx = e.clientX; ly = e.clientY; view.vyaw = view.vpitch = 0;
    canvas.style.cursor = 'grabbing';
    if (pinch.size === 2) pinchDist = dist2();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pinch.has(e.pointerId)) pinch.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.size === 2) {                                           // two fingers: zoom
      const d = dist2(); if (pinchDist) S.camR = clamp(S.camR * (pinchDist / d), 0.9, 7); pinchDist = d; return;
    }
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    const k = 0.0085;
    view.yaw += dx * k; view.pitch = clamp(view.pitch + dy * k, -1.2, 1.2);
    view.vyaw = dx * k * 60 * 0.2; view.vpitch = 0;                   // a touch of inertia (precision matters more than flair)
  });
  const up = (e) => { pinch.delete(e.pointerId); if (pinch.size < 2) pinchDist = 0; if (!pinch.size) { dragging = false; canvas.style.cursor = 'grab'; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); S.camR = clamp(S.camR * Math.exp(e.deltaY * 0.0012), 0.9, 7); }, { passive: false });
  canvas.addEventListener('dblclick', reset);

  function reset() { view.yaw = view.pitch = view.vyaw = view.vpitch = 0; S.camR = view.camR; }
  function dist2() { const [a, b] = [...pinch.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }

  // skeleton helper (bones drawn through the mesh)
  let helper = null;
  function toggleSkeleton() {
    if (!helper) {
      helper = new THREE.SkeletonHelper(phoenix.root);
      helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 999;
      helper.material.color.set(0x00e5ff);
      stage.scene.add(helper);
    } else helper.visible = !helper.visible;
  }

  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    switch (e.code) {
      case 'ArrowLeft': view.yaw -= 0.12; break;
      case 'ArrowRight': view.yaw += 0.12; break;
      case 'ArrowUp': view.pitch = clamp(view.pitch - 0.1, -1.2, 1.2); break;
      case 'ArrowDown': view.pitch = clamp(view.pitch + 0.1, -1.2, 1.2); break;
      case 'Digit1': phoenix.speed = 0.25; break;
      case 'Digit2': phoenix.speed = 0.5; break;
      case 'Digit3': phoenix.speed = 1; break;
      case 'Space': e.preventDefault(); if (phoenix.speed > 0) { lastSpeed = phoenix.speed; phoenix.speed = 0; } else phoenix.speed = lastSpeed || 1; break;
      case 'KeyB': toggleSkeleton(); break;
      case 'KeyR': reset(); break;
    }
  });

  return {
    view, reset,
    /** call every frame */
    update(dt) {
      if (!dragging) { view.yaw += view.vyaw * dt; view.vyaw *= Math.exp(-dt * 5); }
      phoenix.root.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
    },
  };
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
