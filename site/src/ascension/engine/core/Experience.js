// Experience — orchestrates the persistent world: one renderer, one camera, one clock.
// Frame: wind → flight state → rig → camera → emitters/FX → opaque pass (sky, terrain,
// phoenix, feathers) → volumetric clouds (depth-aware) → fire/embers → post → screen.
import * as THREE from 'three';
import { U } from './SharedUniforms.js';
import { Timeline, SEQUENCE } from './Timeline.js';
import { QualityManager, QUALITY_PRESETS } from './QualityManager.js';
import { AtmosphereShader } from '../world/AtmosphereShader.js';
import { EnvironmentalLighting } from '../world/EnvironmentalLighting.js';
import { TerrainSystem } from '../world/Terrain.js';
import { VolumetricClouds } from '../world/VolumetricClouds.js';
import { WindField } from '../world/WindField.js';
import { CinematicCamera } from '../camera/CinematicCamera.js';
import { PhoenixModel } from '../phoenix/PhoenixModel.js';
import { OurPhoenix } from '../phoenix/OurPhoenix.js';
import { PhoenixFlightController } from '../phoenix/PhoenixFlightController.js';
import { PALETTE } from '../phoenix/PhoenixMaterials.js';
import { FlameParticleSystem } from '../fx/FlameParticleSystem.js';
import { FeatherParticleSystem } from '../fx/FeatherParticleSystem.js';
import { PostProcessingPipeline } from '../post/PostProcessingPipeline.js';
import { RigDebugView } from '../debug/RigDebugView.js';

// sombre: the sun has just set (elevation below the horizon): a dusk afterglow on the horizon, the peaks lit by the sky and
// by HER fire. ?sunel=<degrees> to compare (the original was +3.7: a golden sunrise)
const MOOD = globalThis.location ? new URLSearchParams(location.search) : new Map();
const SUN_AZ = THREE.MathUtils.degToRad(31), SUN_EL = THREE.MathUtils.degToRad(+(MOOD.get('sunel') ?? -1.5));
export const SUN_DIR = new THREE.Vector3(-Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

export class Experience {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.on = { stats: null, chapter: null, progress: null, ready: null, error: null, state: null };
    this.toggles = { clouds: true, terrain: true, terrainDetail: true, terrainShadows: true, terrainAO: true, atmosphere: true, cirrus: true, fire: true, embers: true, feathers: true, bloom: true, godrays: true, grading: true, heat: true, autoExposure: true, phoenixPremium: true, emission: true, rig: true, rigDebug: false, regionDebug: false, wind: true, parallax: true };
    this.stats = {};
    this._chapter = null;
    this._running = false;
    this.time = 0;
    this.frameMs = 16; this.cpuMs = 0;
  }

  async init(glbUrl) {
    const prog = (p, label) => this.on.progress?.(p, label);
    prog(0.02, 'Initialising renderer');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.container.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer });
    if (!renderer.capabilities.isWebGL2 && renderer.capabilities.isWebGL2 !== undefined) throw new Error('WebGL 2 is required');
    const gl = renderer.getContext();
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float targets (EXT_color_buffer_float)');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.info.autoReset = false;
    renderer.autoClear = false;
    this.renderer = renderer;
    this.quality = new QualityManager(renderer);
    if (this.opts.quality && this.opts.quality !== 'auto') this.quality.set(this.opts.quality, true);
    const q = this.quality.preset; this.q = q;
    renderer.setPixelRatio(q.pixelRatio);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || this.opts.reducedMotion;

    this.scene = new THREE.Scene(); this.fxScene = new THREE.Scene(); this.heatScene = new THREE.Scene(); this.overlayScene = new THREE.Scene();
    prog(0.06, 'Atmosphere');
    this.atmosphere = new AtmosphereShader(renderer);
    this.atmosphere.update(SUN_DIR);
    this.scene.add(this.atmosphere.skyMesh);
    this.lighting = new EnvironmentalLighting(renderer, this.scene);
    this.envMap = this.lighting.buildEnvironment();
    await this._yield();
    prog(0.12, 'Baking terrain');
    this.terrain = new TerrainSystem(renderer, q);
    this.scene.add(this.terrain.group);
    await this._yield();
    prog(0.3, 'Generating cloud volumes');
    this.clouds = new VolumetricClouds(renderer, q, this.terrain);
    this.wind = new WindField();
    this.timeline = new Timeline();
    this.timeline.on(type => { if (type === 'seek') { this.camera?.snap(); this.clouds?.invalidateHistory(); } });
    this.camera = new CinematicCamera(1);
    this.camera.reducedMotion = this.reducedMotion;
    const top = this.terrain.heightAt(0, 0);
    this.summitTop = new THREE.Vector3(0, top, 0);
    this.camera.perch.copy(this.summitTop);
    await this._yield();
    prog(0.36, 'Loading phoenix');
    this.phoenix = await PhoenixModel.load(glbUrl, p => prog(0.36 + p * 0.4, 'Loading phoenix'));
    prog(0.8, 'Auditing rig & materials');
    this.scene.add(this.phoenix.root);
    this.rig = new OurPhoenix(this.phoenix, this.envMap);           // the original project's phoenix: rig controller + look
    this.flight = new PhoenixFlightController();
    this.flight.perch.copy(this.summitTop).sub(this.phoenix.feetLocal).add(new THREE.Vector3(0, 0.02, 0));
    this.flames = new FlameParticleSystem(q, PALETTE);
    this.fxScene.add(this.flames.mesh); this.heatScene.add(this.flames.heatMesh);
    this.feathers = new FeatherParticleSystem(q, PALETTE);
    this.scene.add(this.feathers.mesh);
    this.rigDebug = new RigDebugView(this.phoenix.rig);
    this.overlayScene.add(this.rigDebug.group);
    this.post = new PostProcessingPipeline(renderer);
    this.post.settings.godrays = q.godrays; this.post.settings.heat = q.heat;
    this._resize();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.container);
    this._onPointer = e => { const r = this.container.getBoundingClientRect(); this.camera.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); };
    window.addEventListener('pointermove', this._onPointer);
    if (this.reducedMotion) this.timeline.seek(SEQUENCE.loopStart + 1);
    prog(0.9, 'Compiling shaders');
    this._step(0.016, true);
    renderer.compile(this.scene, this.camera.camera);
    renderer.compile(this.fxScene, this.camera.camera);
    await this._yield();
    // warm the temporal buffers (cloud reprojection, exposure) behind the loader
    this._resize();
    for (let i = 0; i < 10; i++) this.frame(0);
    prog(1, 'Ready');
    this.on.ready?.(this);
    return this;
  }

  _yield() { return new Promise(r => setTimeout(r, 0)); }

  _resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const r = this.renderer; r.setSize(w, h, false);
    const pr = r.getPixelRatio(); const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.W = W; this.H = H;
    this.camera.resize(w / h);
    [this.sceneRT, this.compositeRT, this.heatRT].forEach(t => t && t.dispose());
    const depth = new THREE.DepthTexture(W, H, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, depthTexture: depth, samples: this.q.msaa, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.compositeRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.heatRT = new THREE.WebGLRenderTarget(Math.max(1, W >> 2), Math.max(1, H >> 2), { type: THREE.HalfFloatType, depthBuffer: false });
    this.clouds.setSize(W, H);
    this.post.setSize(W, H);
    U.uResolution.value.set(W, H);
    this.flames.setDepth(this.sceneRT.depthTexture);
  }

  start() {
    if (this._running) return; this._running = true; this._last = performance.now(); this._lastTick = performance.now();
    const tick = now => { const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000)); this._last = now; this._lastTick = performance.now(); this.frame(dt); };
    const loop = now => { if (!this._running) return; this._raf = requestAnimationFrame(loop); tick(performance.now()); };
    this._raf = requestAnimationFrame(loop);
    // watchdog: some embedding contexts suspend rAF for off-screen frames; keep the world alive
    this._wd = setInterval(() => { if (this._running && performance.now() - this._lastTick > 300) tick(performance.now()); }, 40);
  }
  stop() { this._running = false; cancelAnimationFrame(this._raf); clearInterval(this._wd); }

  _step(dt, snap = false) {
    U.uTime.value += dt; U.uFrame.value++;
    const time = U.uTime.value;
    const t = this.timeline.update(snap ? 0 : dt);
    this.wind.update(dt, time);
    const fo = this.flight.evaluate(t, time);
    const ph = this.phoenix;
    ph.root.position.copy(fo.position); ph.root.quaternion.copy(fo.quaternion);
    ph.root.updateMatrixWorld(true);
    this.rig.update(dt, { t, time, fo, flight: this.flight, wind: this.wind, camera: this.camera.camera });
    // foot lock while perched: keep the talons planted on the summit while the body crouches
    const W = fo.weights;
    const lockW = THREE.MathUtils.clamp((W.IDLE || 0) + (W.ANTICIPATION || 0) + (W.TAKEOFF || 0) * Math.max(0, 1 - (t - 9.4) / 0.4), 0, 1) * (this.flight.manual && !['IDLE', 'ANTICIPATION'].includes(this.flight.manual.state) ? 0 : 1);
    if (lockW > 0.001) {
      // planted on the summit: the feet's MESH (not the bones: the claws reach below them) touches the rock, centred on the top
      ph.root.updateMatrixWorld(true);
      const fc = this.rig.footContact((x, z) => this.terrain.heightAt(x, z));
      ph.root.position.x += (this.summitTop.x - fc.x) * lockW;
      ph.root.position.z += (this.summitTop.z - fc.z) * lockW;
      ph.root.position.y += (0.01 - fc.low) * lockW;
      ph.root.updateMatrixWorld(true);
      const fc2 = this.rig.footContact((x, z) => this.terrain.heightAt(x, z));      // moved sideways: touch again
      ph.root.position.y += (0.01 - fc2.low) * lockW;
    }
    this.fo = fo;
    // camera tracks the body centre
    const body = new THREE.Vector3(0, 1.45, 0).applyQuaternion(fo.quaternion).add(fo.position);
    this.camera.update(t, dt, body, this.terrain);
    if (snap) this.camera.snap(), this.camera.update(t, 0.016, body, this.terrain);
    this.scene.updateMatrixWorld();
    ph.updateEmitters(snap ? 0 : dt);
    const cam = this.camera.camera;
    // shared uniforms
    U.uPrevViewProj.value.copy(U.uViewProj.value);
    U.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    U.uCamPos.value.copy(cam.position); U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld);
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    const chest = new THREE.Vector3().setFromMatrixPosition(ph.chestBone.matrixWorld);
    U.uFirePos.value.copy(chest).add(new THREE.Vector3(0, 0.4, 0));
    U.uFireIntensity.value = this.toggles.emission && this.toggles.phoenixPremium ? 6 * fo.energy * fo.energy : 0;
    const mu = ph.premium.userData.uniforms;
    mu.uEnergy.value = fo.energy; mu.uSunView.value.copy(U.uSunDir.value).transformDirection(cam.matrixWorldInverse);
    this.lighting.apply(fo.position);
    // FX
    const featherRate = (fo.weights.ANTICIPATION || 0) * 0.9 + (fo.weights.TAKEOFF || 0) * 5 + (fo.weights.FLIGHT || 0) * 0.5 + (fo.weights.HOVER || 0) * 0.6 + (fo.weights.GLIDE || 0) * 0.25;
    if (!snap) {
      if (this._prevChapter !== 'takeoff' && this.timeline.chapter === 'takeoff') { this.feathers.burst(12); this.flames.burst = 1.4; }
      this.flames.update(dt, time, ph, this.wind, fo.energy, fo.speed);
      this.feathers.update(dt, time, ph, this.wind, cam, this.toggles.feathers ? featherRate : 0);
    }
    this._prevChapter = this.timeline.chapter;
    this.rigDebug.update();
    const ch = this.timeline.chapter;
    if (ch !== this._chapter) { this._chapter = ch; this.on.chapter?.(ch); }
    if (fo.state !== this._state) { this._state = fo.state; this.on.state?.(fo.state); }
    return t;
  }

  frame(dt) {
    try { this._frame(dt); }
    catch (e) { if (!this._errLogged) { this._errLogged = true; console.error('[PhoenixAscension] frame error: ' + (e && e.message) + '\n' + (e && e.stack)); } }
  }

  _frame(dt) {
    const c0 = performance.now();
    const r = this.renderer;
    r.info.reset();
    this._step(dt);
    const cam = this.camera.camera;
    // 1 opaque world
    r.setRenderTarget(this.sceneRT); r.setClearColor(0x000000, 1); r.clear(true, true, false);
    r.render(this.scene, cam);
    // 2 clouds (march + temporal + depth-aware composite into compositeRT)
    this.clouds.render(this.sceneRT, this.compositeRT);
    // 3 fire & embers (soft depth test against the scene depth)
    r.setRenderTarget(this.compositeRT);
    r.render(this.fxScene, cam);
    if (this.rigDebug.group.visible) r.render(this.overlayScene, cam);
    // 4 heat mask for distortion
    const heatOn = this.post.settings.heat && this.toggles.heat;
    if (heatOn) { r.setRenderTarget(this.heatRT); r.setClearColor(0x000000, 1); r.clear(true, false, false); r.render(this.heatScene, cam); }
    // 5 post
    const sun = this.camera.sunScreen(U.uSunDir.value);
    this.post.render(this.compositeRT, this.sceneRT.depthTexture, heatOn ? this.heatRT.texture : null, sun, dt);
    this.cpuMs = performance.now() - c0;
    this.frameMs = this.frameMs * 0.92 + dt * 1000 * 0.08;
    const nl = this.quality.sample(dt * 1000);
    if (nl) this.setQuality(nl, false);
    this._statsTimer = (this._statsTimer || 0) + dt;
    if (this._statsTimer > 0.5) { this._statsTimer = 0; this._emitStats(); }
  }

  _emitStats() {
    const r = this.renderer, info = r.info;
    const px = this.W * this.H;
    const rtMB = (px * (8 + 4) * Math.max(1, this.q.msaa) + px * 8 + px * 2 + (this.clouds.low.x * this.clouds.low.y) * 8 * 3 + px * 8 * 0.66) / 1048576;
    const noise3d = Math.pow(this.q.noiseSize || 128, 3) * 4 / 1048576;
    const terrainMB = this.terrain.vertices * (12 + 8 + 32) / 1048576;
    this.stats = {
      fps: Math.round(1000 / Math.max(1, this.frameMs)), frameMs: +this.frameMs.toFixed(1), cpuMs: +this.cpuMs.toFixed(2),
      drawCalls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures,
      gpuMemMB: Math.round(rtMB + noise3d + terrainMB + 12),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      particles: { flames: this.flames.flames.n, embers: this.flames.embers.n, feathers: this.feathers.count || 0 },
      quality: this.quality.level, resolution: `${this.W}×${this.H}`, cloudRes: `${this.clouds.low.x}×${this.clouds.low.y}`,
      time: +this.timeline.time.toFixed(2), chapter: this.timeline.chapter, state: this.fo?.state, energy: +(this.fo?.energy || 0).toFixed(2),
      terrainTris: this.terrain.triangles, gpu: this.quality.gpu,
    };
    this.on.stats?.(this.stats);
  }

  setToggle(key, on) {
    this.toggles[key] = on;
    const P = this.post.settings;
    switch (key) {
      case 'clouds': this.clouds.enabled = on; this.clouds.invalidateHistory(); break;
      case 'terrain': this.terrain.setToggle('terrain', on); break;
      case 'terrainDetail': this.terrain.setToggle('detail', on); break;
      case 'terrainShadows': this.terrain.setToggle('shadows', on); break;
      case 'terrainAO': this.terrain.setToggle('ao', on); break;
      case 'atmosphere': U.uAtmosphereOn.value = on ? 1 : 0; break;
      case 'cirrus': this.atmosphere.skyMaterial.uniforms.uCirrus.value = on ? 1 : 0; break;
      case 'fire': this.flames.flamesOn = on; break;
      case 'embers': this.flames.embersOn = on; break;
      case 'feathers': this.feathers.enabled = on; this.feathers.mesh.visible = on; break;
      case 'bloom': P.bloom = on ? 1 : 0; break;
      case 'godrays': P.godrays = on ? 1 : 0; break;
      case 'grading': P.grading = on ? 1 : 0; break;
      case 'heat': P.heat = on ? 1 : 0; break;
      case 'autoExposure': P.autoExposure = on ? 1 : 0; break;
      case 'phoenixPremium': this.phoenix.setOriginal(!on); break;
      case 'emission': this.phoenix.premium.userData.uniforms.uEmission.value = on ? 1 : 0; break;
      case 'rig': this.rig.enabled = on; break;
      case 'rigDebug': this.rigDebug.group.visible = on; break;
      case 'regionDebug': this.phoenix.premium.userData.uniforms.uRegionDebug.value = on ? 1 : 0; break;
      case 'wind': this.wind.enabled = on; break;
      case 'parallax': this.camera.parallax = on ? 1 : 0; break;
    }
  }

  setState(name) {
    this.flight.setManual(name, U.uTime.value, this.phoenix.root.position);
    if (name === 'TAKEOFF') { this.feathers.burst(10); this.flames.burst = 1.4; }
  }

  setQuality(level, lock = true) {
    this.quality.set(level, lock);
    const q = this.quality.preset; this.q = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    // rebuild resolution-dependent and LOD-dependent systems in the same persistent world
    this.scene.remove(this.terrain.group); this.terrain.dispose();
    this.terrain = new TerrainSystem(this.renderer, q); this.scene.add(this.terrain.group);
    ['terrainDetail', 'terrainShadows', 'terrainAO'].forEach(k => this.setToggle(k, this.toggles[k]));
    this.clouds.hm = this.terrain.cloudHeightMap; this.clouds.marchMat.uniforms.tHM.value = this.terrain.cloudHeightMap.texture;
    this.clouds.setQuality(q);
    this.fxScene.remove(this.flames.mesh); this.heatScene.remove(this.flames.heatMesh);
    this.flames = new FlameParticleSystem(q, PALETTE); this.fxScene.add(this.flames.mesh); this.heatScene.add(this.flames.heatMesh);
    this.scene.remove(this.feathers.mesh);
    this.feathers = new FeatherParticleSystem(q, PALETTE); this.scene.add(this.feathers.mesh);
    this.post.settings.godrays = q.godrays && this.toggles.godrays ? 1 : 0; this.post.settings.heat = q.heat && this.toggles.heat ? 1 : 0;
    ['fire', 'embers', 'feathers'].forEach(k => this.setToggle(k, this.toggles[k]));
    this._resize();
  }

  rigReport() { const r = this.phoenix.rig; return { report: r.report, mapping: r.mapping, overrides: r.overrides }; }

  dispose() {
    this.stop(); this._ro?.disconnect(); window.removeEventListener('pointermove', this._onPointer);
    this.terrain?.dispose(); this.renderer?.dispose(); this.renderer?.domElement.remove();
  }
}
