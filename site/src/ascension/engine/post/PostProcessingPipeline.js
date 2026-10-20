// PostProcessingPipeline — HDR chain: selective (thresholded HDR) bloom with a dual-filter
// mip pyramid, screen-space light shafts from the shared sun, subtle heat distortion,
// controlled auto-exposure, ACES tone mapping, colour grading, vignette and dithering.
import * as THREE from 'three';
import { fullscreenGeometry } from '../world/AtmosphereShader.js';
import { U } from '../core/SharedUniforms.js';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts });

export class PostProcessingPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(fullscreenGeometry()); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.levels = 6;
    this.mips = []; this.ups = [];
    this.settings = { bloom: 1, bloomStrength: 0.055, threshold: 1.4, knee: 0.9, godrays: 1, godraysStrength: 0.35, grading: 1, exposure: 1.0, vignette: 0.18, grain: 0.022, heat: 1, autoExposure: 1, saturation: 1.1 };
    this.exposureRT = [rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })];
    this.expIdx = 0; this.expInit = false;
    this.mat = {
      prefilter: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
        void main(){
          vec3 c = (s(vec2(-1.0,-1.0)) + s(vec2(1.0,-1.0)) + s(vec2(-1.0,1.0)) + s(vec2(1.0,1.0))) * 0.25;
          c = min(c, vec3(220.0));
          float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0*uKnee); rq = rq*rq / (4.0*uKnee + 1e-4);
          float w = max(rq, br - uThreshold) / max(br, 1e-4);
          gl_FragColor = vec4(c * w, 1.0);
        }`),
      down: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
        void main(){
          vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
          vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
          vec3 g = s(vec2(-2.0,-2.0)), h = s(vec2(0.0,-2.0)), i = s(vec2(2.0,-2.0));
          vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0,-1.0)), m = s(vec2(1.0,-1.0));
          vec3 o = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
          gl_FragColor = vec4(o, 1.0);
        }`),
      up: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel*uRadius).rgb; }
        void main(){
          vec3 o = s(vec2(-1.0,1.0)) + 2.0*s(vec2(0.0,1.0)) + s(vec2(1.0,1.0)) + 2.0*s(vec2(-1.0,0.0)) + 4.0*s(vec2(0.0)) + 2.0*s(vec2(1.0,0.0)) + s(vec2(-1.0,-1.0)) + 2.0*s(vec2(0.0,-1.0)) + s(vec2(1.0,-1.0));
          gl_FragColor = vec4(o/16.0 + texture2D(tBase, vUv).rgb, 1.0);
        }`),
      shaftMask: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
        void main(){
          float d = texture2D(tDepth, vUv).x;
          vec3 c = texture2D(tSrc, vUv).rgb;
          float sky = step(0.99999, d);
          vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
          float fall = exp(-dot(dv, dv) * 9.0);
          float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - 1.1, 0.0);
          gl_FragColor = vec4(c / max(dot(c, vec3(0.333)), 1e-3) * min(l, 30.0) * sky * fall, 1.0);
        }`),
      shaftBlur: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep; uniform float uFrame; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame*0.61) * 43758.5453); }
        void main(){
          vec2 dir = (uSun - vUv) * uStep;
          vec2 uv = vUv + dir * h(gl_FragCoord.xy);
          vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
          for (int i = 0; i < 24; i++){ acc += texture2D(tSrc, uv).rgb * w; ws += w; w *= 0.955; uv += dir; }
          gl_FragColor = vec4(acc / ws, 1.0);
        }`),
      exposure: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform sampler2D tPrev; uniform float uDt; uniform float uInit; varying vec2 vUv;
        void main(){
          float s = 0.0;
          for (int y = 0; y < 6; y++) for (int x = 0; x < 8; x++){
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(8.0, 6.0);
            float w = 1.0 - 0.6 * length(uv - 0.5);
            s += log(max(dot(texture2D(tSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3)) * w;
          }
          float avg = exp(s / 34.5);
          float prev = texture2D(tPrev, vec2(0.5)).r;
          float v = uInit > 0.5 ? avg : mix(prev, avg, 1.0 - exp(-uDt * 0.9));
          gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
        }`),
      final: this._m(/* glsl */`
        uniform sampler2D tSrc; uniform sampler2D tBloom; uniform sampler2D tShafts; uniform sampler2D tHeat; uniform sampler2D tExposure;
        uniform float uBloom; uniform float uShafts; uniform float uExposure; uniform float uGrading; uniform float uVignette; uniform float uGrain;
        uniform float uFrame; uniform float uHeatOn; uniform float uAuto; uniform float uSaturation; uniform float uTime; uniform vec2 uRes;
        varying vec2 vUv;
        vec3 aces(vec3 x){ // ACES fitted (Hill)
          const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
          const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
          x = i * x; vec3 a = x*(x + 0.0245786) - 0.000090537; vec3 b = x*(0.983729*x + 0.4329510) + 0.238081; return clamp(o * (a / b), 0.0, 1.0);
        }
        vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          vec2 uv = vUv;
          if (uHeatOn > 0.5){
            float ht = texture2D(tHeat, uv).r;
            if (ht > 0.002){
              vec2 n = vec2(sin(uv.y*170.0 + uTime*9.0) + sin(uv.y*83.0 - uTime*6.1), cos(uv.x*150.0 - uTime*8.3) + sin(uv.x*61.0 + uTime*5.2));
              uv += n * min(ht, 1.0) * 0.0011;
            }
          }
          vec3 c = texture2D(tSrc, uv).rgb;
          c += texture2D(tBloom, uv).rgb * uBloom;
          c += texture2D(tShafts, uv).rgb * uShafts;
          float avgL = texture2D(tExposure, vec2(0.5)).r;
          float ev = uAuto > 0.5 ? clamp(log2(0.2 / max(avgL, 1e-4)), -1.4, 0.35) : 0.0;
          c *= uExposure * exp2(ev);
          // graduated ND (camera filter): calmer sky in the upper-left where the title sits
          float nd = smoothstep(0.25, 1.15, (1.0 - vUv.x) * 0.75 + vUv.y * 0.85 - 0.25);
          c *= mix(1.0, 0.62, nd * uGrading);
          if (uGrading > 0.5){
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // split toning: cool petrol shadows, warm golden highlights
            vec3 sh = vec3(0.80, 0.95, 1.16), hi = vec3(1.08, 1.0, 0.88);
            float t = smoothstep(0.02, 0.9, l / (1.0 + l));
            c *= mix(sh, hi, t);
            // filmic contrast around mid-grey (log space)
            c = exp2((log2(max(c, vec3(1e-5))) - log2(0.18)) * 1.1 + log2(0.18));
          }
          c = aces(c);
          float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l2), c, uSaturation);
          vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
          c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
          c = srgb(clamp(c, 0.0, 1.0));
          float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + mod(uFrame, 64.0)*5.588238, vec2(0.06711056, 0.00583715))));
          c += (n - 0.5) * (1.0/255.0 + uGrain * 0.08);
          gl_FragColor = vec4(c, 1.0);
        }`),
    };
  }

  _m(fs) { return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, uniforms: {
    tSrc: { value: null }, tBase: { value: null }, tDepth: { value: null }, tPrev: { value: null }, tBloom: { value: null }, tShafts: { value: null }, tHeat: { value: null }, tExposure: { value: null },
    uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uRadius: { value: 1 }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uStep: { value: 0.02 },
    uFrame: U.uFrame, uTime: U.uTime, uDt: { value: 0.016 }, uInit: { value: 1 }, uBloom: { value: 0 }, uShafts: { value: 0 }, uExposure: { value: 1 }, uGrading: { value: 1 }, uVignette: { value: 0.2 }, uGrain: { value: 0.02 },
    uHeatOn: { value: 1 }, uAuto: { value: 1 }, uSaturation: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
  } }); }

  setSize(w, h, scale = 1) {
    this.w = w; this.h = h;
    this.mips.forEach(r => r.dispose()); this.ups.forEach(r => r.dispose());
    this.mips = []; this.ups = [];
    let mw = Math.floor(w / 2), mh = Math.floor(h / 2);
    for (let i = 0; i < this.levels; i++) { this.mips.push(rt(mw, mh)); this.ups.push(rt(mw, mh)); mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); }
    if (this.shaftA) { this.shaftA.dispose(); this.shaftB.dispose(); }
    this.shaftA = rt(Math.floor(w / 4), Math.floor(h / 4)); this.shaftB = rt(Math.floor(w / 4), Math.floor(h / 4));
    this.mat.final.uniforms.uRes.value.set(w, h);
  }

  _pass(mat, target) { this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.quad, this.cam); }

  render(src, depthTex, heatTex, sunUV, dt) {
    const S = this.settings, m = this.mat;
    // auto exposure (log-average luminance, slow adaptation)
    m.exposure.uniforms.tSrc.value = src.texture; m.exposure.uniforms.tPrev.value = this.exposureRT[this.expIdx].texture;
    m.exposure.uniforms.uDt.value = dt; m.exposure.uniforms.uInit.value = this.expInit ? 0 : 1;
    this.expIdx ^= 1; this._pass(m.exposure, this.exposureRT[this.expIdx]); this.expInit = true;
    // bloom
    const black = this.ups[this.levels - 1];
    if (S.bloom) {
      m.prefilter.uniforms.tSrc.value = src.texture; m.prefilter.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      m.prefilter.uniforms.uThreshold.value = S.threshold; m.prefilter.uniforms.uKnee.value = S.knee;
      this._pass(m.prefilter, this.mips[0]);
      for (let i = 1; i < this.levels; i++) { m.down.uniforms.tSrc.value = this.mips[i - 1].texture; m.down.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height); this._pass(m.down, this.mips[i]); }
      let cur = this.mips[this.levels - 1];
      for (let i = this.levels - 2; i >= 0; i--) {
        m.up.uniforms.tSrc.value = cur.texture; m.up.uniforms.tBase.value = this.mips[i].texture;
        m.up.uniforms.uTexel.value.set(1 / cur.width, 1 / cur.height); m.up.uniforms.uRadius.value = 1.0;
        this._pass(m.up, this.ups[i]); cur = this.ups[i];
      }
    }
    // light shafts
    const sunVisible = sunUV && sunUV.z > 0;
    if (S.godrays && sunVisible) {
      m.shaftMask.uniforms.tSrc.value = src.texture; m.shaftMask.uniforms.tDepth.value = depthTex; m.shaftMask.uniforms.uSun.value.set(sunUV.x, sunUV.y);
      m.shaftMask.uniforms.uAspect.value = this.w / this.h;
      this._pass(m.shaftMask, this.shaftA);
      m.shaftBlur.uniforms.uSun.value.set(sunUV.x, sunUV.y);
      m.shaftBlur.uniforms.tSrc.value = this.shaftA.texture; m.shaftBlur.uniforms.uStep.value = 1 / 24 * 0.9; this._pass(m.shaftBlur, this.shaftB);
      m.shaftBlur.uniforms.tSrc.value = this.shaftB.texture; m.shaftBlur.uniforms.uStep.value = 1 / 24 * 0.3; this._pass(m.shaftBlur, this.shaftA);
    }
    const f = m.final.uniforms;
    f.tSrc.value = src.texture; f.tBloom.value = S.bloom ? this.ups[0].texture : black.texture;
    f.tShafts.value = this.shaftA.texture; f.uShafts.value = S.godrays && sunVisible ? S.godraysStrength : 0;
    f.tHeat.value = heatTex; f.uHeatOn.value = S.heat && heatTex ? 1 : 0;
    f.tExposure.value = this.exposureRT[this.expIdx].texture; f.uAuto.value = S.autoExposure;
    f.uBloom.value = S.bloom ? S.bloomStrength : 0; f.uExposure.value = S.exposure; f.uGrading.value = S.grading;
    f.uVignette.value = S.vignette; f.uGrain.value = S.grain; f.uSaturation.value = S.grading ? S.saturation : 1;
    this._pass(m.final, null);
  }
}
