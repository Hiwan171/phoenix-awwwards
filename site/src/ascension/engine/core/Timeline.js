// Timeline — single authored clock for the cinematic sequence. Everything directed
// (phoenix state, trajectory, camera) is a pure function of timeline time, so the same
// sequence can be played, scrubbed, or bound to page scroll later (setProgress).
export const SEQUENCE = {
  opening: [0, 4.0],
  awakening: [4.0, 9.4],
  takeoff: [9.4, 12.2],
  flight: [12.2, 24.0],
  loopStart: 24.0,
  loopPeriod: 26.0,
};

export class Timeline {
  constructor() {
    this.time = 0; this.playing = true; this.speed = 1;
    this.introDuration = SEQUENCE.loopStart;
    this._listeners = new Set();
  }
  update(dt) { if (this.playing) this.time += dt * this.speed; return this.time; }
  seek(t) { this.time = Math.max(0, t); this._emit('seek'); }
  play() { this.playing = true; this._emit('play'); }
  pause() { this.playing = false; this._emit('pause'); }
  restart() { this.seek(0); this.play(); }
  // scroll integration: map 0..1 onto the authored intro (camera travels the same world)
  setProgress(p) { this.seek(Math.min(1, Math.max(0, p)) * this.introDuration); }
  get progress() { return Math.min(1, this.time / this.introDuration); }
  get chapter() {
    const t = this.time;
    for (const k of ['opening', 'awakening', 'takeoff', 'flight']) if (t >= SEQUENCE[k][0] && t < SEQUENCE[k][1]) return k;
    return 'loop';
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(type) { this._listeners.forEach(fn => fn(type, this)); }
}
