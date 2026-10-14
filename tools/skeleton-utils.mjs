// Light Laplacian smoothing of chain joints (kills mean-shift zig-zags). Endpoints stay put.
export function smoothChains(sk, groups, iters = 3) {
  for (const g of groups) {
    const js = sk.joints.filter((j) => j.group === g);
    for (let it = 0; it < iters; it++) {
      const np = js.map((j, i) => (i === 0 || i === js.length - 1)
        ? j.pos
        : js[i-1].pos.map((v, k) => 0.25 * v + 0.5 * j.pos[k] + 0.25 * js[i+1].pos[k]));
      js.forEach((j, i) => { j.pos = np[i]; });
    }
  }
}
