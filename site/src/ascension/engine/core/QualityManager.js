// QualityManager — Ultra / High / Medium / Low profiles, device heuristics, and progressive
// degradation driven by measured frame time (never silently below the chosen floor).
export const QUALITY_PRESETS = {
  ultra: { name: 'ultra', pixelRatio: 2, msaa: 4, summitRings: 512, farRings: 320, terrainSegments: 1024, terrainShadowSteps: 48, cloudScale: 0.5, cloudSteps: 120, cloudStepK: 0.05, cloudLightSteps: 6, noiseSize: 128, embers: 1800, flames: 1100, feathers: 70, godrays: 1, heat: 1 },
  high: { name: 'high', pixelRatio: 1.5, msaa: 4, summitRings: 448, farRings: 288, terrainSegments: 896, terrainShadowSteps: 40, cloudScale: 0.5, cloudSteps: 84, cloudStepK: 0.065, cloudLightSteps: 5, noiseSize: 128, embers: 1300, flames: 850, feathers: 56, godrays: 1, heat: 1 },
  medium: { name: 'medium', pixelRatio: 1, msaa: 2, summitRings: 300, farRings: 200, terrainSegments: 576, terrainShadowSteps: 32, cloudScale: 0.42, cloudSteps: 58, cloudStepK: 0.09, cloudLightSteps: 4, noiseSize: 96, embers: 800, flames: 600, feathers: 40, godrays: 1, heat: 0 },
  low: { name: 'low', pixelRatio: 0.8, msaa: 0, summitRings: 256, farRings: 176, terrainSegments: 512, terrainShadowSteps: 22, cloudScale: 0.34, cloudSteps: 38, cloudStepK: 0.14, cloudLightSteps: 3, noiseSize: 64, embers: 380, flames: 320, feathers: 22, godrays: 0, heat: 0 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export class QualityManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.locked = false;
    this.samples = [];
    this.cooldown = 4;
    this.level = this.detect();
  }
  detect() {
    const q = new URLSearchParams(location.search).get('quality');
    if (q && QUALITY_PRESETS[q]) { this.locked = true; return q; }
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '') || '';
    this.gpu = gpu;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const px = innerWidth * innerHeight * Math.min(devicePixelRatio, 2) ** 2;
    if (mobile) return 'low';
    if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
    if (/Intel|UHD|Iris|Mali|Adreno|PowerVR/i.test(gpu)) return px > 1.6e6 ? 'low' : 'medium';
    if (/RTX 4|RTX 3|RX 7|RX 6[789]|Apple M[234]|Apple M1 (Pro|Max|Ultra)/i.test(gpu)) return px > 6e6 ? 'high' : 'ultra';
    return 'high';
  }
  get preset() {
    const p = { ...QUALITY_PRESETS[this.level] };
    p.pixelRatio = Math.min(p.pixelRatio, window.devicePixelRatio || 1);
    return p;
  }
  // returns a new level when the measured frame time stays above budget
  sample(dtMs) {
    if (this.locked) return null;
    this.cooldown -= dtMs / 1000;
    if (this.cooldown > 0) return null;
    this.samples.push(dtMs);
    if (this.samples.length < 150) return null;
    const s = this.samples.slice().sort((a, b) => a - b);
    const p50 = s[Math.floor(s.length * 0.5)];
    this.samples.length = 0;
    const i = QUALITY_ORDER.indexOf(this.level);
    if (p50 > 34 && i > 0) { this.level = QUALITY_ORDER[i - 1]; this.cooldown = 5; return this.level; }
    return null;
  }
  set(level, lock = true) { if (QUALITY_PRESETS[level]) { this.level = level; this.locked = lock; this.samples.length = 0; } }
}
