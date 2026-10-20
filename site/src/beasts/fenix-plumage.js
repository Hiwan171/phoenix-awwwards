// Opening-only secondary motion for the original back feather layers. Their authored skin weights remain on the spine/wing:
// recovering the unused F_back weights would detach those layers during flight. The small companion file recovers only
// membership and distance along each original feather; positions, indices and skin weights are never changed.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const installed = new WeakMap();

export async function createFenixPlumage({ mesh, variant = 'web', amplitude = 0.006, strainLimit = 0.015 } = {}) {
  if (installed.has(mesh)) return installed.get(mesh);
  const response = await fetch(`/models/fenix-plumage-${variant}.bin`);
  if (!response.ok) throw new Error(`Back plumage metadata: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer(), data = new DataView(bytes), geometry = mesh.geometry, position = geometry.attributes.position;
  if (bytes.byteLength < 12 || data.getUint32(0, true) !== 0x504c4d31 || data.getUint32(4, true) !== position.count) throw new Error('Back plumage metadata does not match this geometry');
  const count = data.getUint32(8, true);
  if (bytes.byteLength !== 12 + count * 8) throw new Error('Incomplete back plumage metadata');

  const chainMap = new Map(), rest = new THREE.Matrix4(), fromBind = mesh.bindMatrix.clone().invert();
  mesh.skeleton.bones.forEach((bone, index) => {
    const match = /^F_back_(\d+)_(\d+)$/.exec(bone.name);
    if (!match) return;
    const key = +match[1];
    if (!chainMap.has(key)) chainMap.set(key, []);
    rest.copy(mesh.skeleton.boneInverses[index]).invert().premultiply(fromBind);
    chainMap.get(key)[+match[2]] = new THREE.Vector3().setFromMatrixPosition(rest);
  });
  const chains = [...chainMap.entries()].sort((a, b) => a[0] - b[0]);
  if (!chains.length) throw new Error('Back plumage guide chains are missing');
  const indices = new Map(chains.map(([key], i) => [key, i]));
  const roots = [], directions = [];
  for (const [key, points] of chains) {
    const root = points[0], direction = points[points.length - 1].clone().sub(root).normalize();
    roots.push(new THREE.Vector4(root.x, root.y, root.z, key * 0.83));
    directions.push(new THREE.Vector4(direction.x, direction.y, direction.z, 0));
  }
  const attribute = new Float32Array(position.count * 2);
  for (let n = 0; n < count; n++) {
    const offset = 12 + n * 8, vertex = data.getUint32(offset, true), chain = indices.get(data.getUint16(offset + 4, true));
    if (vertex >= position.count || chain === undefined) throw new Error('Back plumage vertex/chain is invalid');
    attribute[vertex * 2] = chain; attribute[vertex * 2 + 1] = data.getUint16(offset + 6, true) / 65535;
  }
  // Simplification may keep only some of a strip's original vertices. Never switch chain or mask abruptly inside a
  // triangle: recover the original owner per index-component, then use a continuous projection along that guide.
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const triangles = geometry.index.array;
  for (let i = 0; i < triangles.length; i += 3) { join(triangles[i], triangles[i + 1]); join(triangles[i], triangles[i + 2]); }
  const components = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = find(i);
    if (!components.has(key)) components.set(key, { vertices: [], votes: new Map(), selected: 0 });
    const c = components.get(key); c.vertices.push(i);
    if (attribute[i * 2 + 1] > 0) { const chain = attribute[i * 2]; c.votes.set(chain, (c.votes.get(chain) ?? 0) + 1); c.selected++; }
  }
  attribute.fill(0);
  const point = new THREE.Vector3(), segment = new THREE.Vector3(), relative = new THREE.Vector3();
  let recovered = 0;
  for (const component of components.values()) {
    if (!component.selected || component.vertices.length > 1800) continue;
    const [chain, votes] = [...component.votes].sort((a, b) => b[1] - a[1])[0];
    if (votes < 0.8 * component.selected || component.selected < Math.min(3, component.vertices.length * 0.1)) continue;
    const points = chains[chain][1], lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = lengths[lengths.length - 1]; if (total < 0.0001) continue;
    recovered++;
    for (const vertex of component.vertices) {
      point.fromBufferAttribute(position, vertex);
      let nearest = Infinity, along = 0;
      for (let i = 1; i < points.length; i++) {
        segment.subVectors(points[i], points[i - 1]); relative.subVectors(point, points[i - 1]);
        const t = clamp(relative.dot(segment) / segment.lengthSq(), 0, 1);
        relative.addScaledVector(segment, -t);
        if (relative.lengthSq() < nearest) { nearest = relative.lengthSq(); along = (lengths[i - 1] + t * (lengths[i] - lengths[i - 1])) / total; }
      }
      const x = clamp((along - 0.35) / 0.65, 0, 1);
      attribute[vertex * 2] = chain; attribute[vertex * 2 + 1] = x * x * (3 - 2 * x);
    }
  }
  // UV and material seams sometimes repeat a position under separate indices. Pin every copy at a contact with another
  // layer or chain, rather than opening a gap. The chain's own first third was already pinned by the metadata baker.
  const copies = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = position.getX(i) + ',' + position.getY(i) + ',' + position.getZ(i);
    if (!copies.has(key)) copies.set(key, []);
    copies.get(key).push(i);
  }
  let pinned = 0;
  for (const vertices of copies.values()) {
    if (vertices.length < 2) continue;
    const chain = attribute[vertices[0] * 2];
    let weight = 1, different = false;
    for (const i of vertices) { weight = Math.min(weight, attribute[i * 2 + 1]); different ||= attribute[i * 2] !== chain; }
    if (different) weight = 0;
    for (const i of vertices) { if (weight === 0 && attribute[i * 2 + 1] > 0) pinned++; attribute[i * 2 + 1] = weight; }
  }
  // Limit the displacement difference across EVERY affected edge. A min-plus graph relaxation gives a field whose
  // slope is <= strainLimit: moving along one common wind vector can then change an edge length by at most that share.
  // This also feathers the motion gently away from pinned contacts instead of tearing a tiny triangle at a hard mask.
  const adjacency = new Map(), distances = new Float64Array(position.count), a = new THREE.Vector3(), b = new THREE.Vector3();
  const travel = clamp(amplitude, 0, 0.01), slope = clamp(strainLimit, 0, 0.025), unique = new Set();
  for (let i = 0; i < position.count; i++) distances[i] = attribute[i * 2 + 1] * travel;
  for (let t = 0; t < triangles.length; t += 3) for (let k = 0; k < 3; k++) {
    let v = triangles[t + k], w = triangles[t + (k + 1) % 3];
    if (!distances[v] && !distances[w]) continue;
    if (v > w) [v, w] = [w, v];
    const key = v * position.count + w; if (unique.has(key)) continue; unique.add(key);
    a.fromBufferAttribute(position, v); b.fromBufferAttribute(position, w); const cost = a.distanceTo(b) * slope;
    if (!adjacency.has(v)) adjacency.set(v, []); if (!adjacency.has(w)) adjacency.set(w, []);
    adjacency.get(v).push([w, cost]); adjacency.get(w).push([v, cost]);
  }
  const heap = [];
  const push = (vertex, distance) => {
    let i = heap.length; const item = [vertex, distance]; heap.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][1] <= distance) break; heap[i] = heap[p]; i = p; } heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][1] < heap[c][1]) c++; if (heap[c][1] >= last[1]) break; heap[i] = heap[c]; i = c; } heap[i] = last; }
    return first;
  };
  for (const vertex of adjacency.keys()) push(vertex, distances[vertex]);
  while (heap.length) {
    const [vertex, distance] = pop(); if (distance !== distances[vertex]) continue;
    for (const [next, cost] of adjacency.get(vertex)) if (distance + cost < distances[next]) { distances[next] = distance + cost; push(next, distances[next]); }
  }
  for (let i = 0; i < position.count; i++) attribute[i * 2 + 1] = distances[i];
  geometry.setAttribute('aPlumage', new THREE.BufferAttribute(attribute, 2));
  const uniforms = {
    uPlumageRoots: { value: roots }, uPlumageDirections: { value: directions },
    uPlumageTime: { value: 0 }, uPlumageWind: { value: 0 },
    uPlumageAir: { value: new THREE.Vector3(1, 0, 0) },
  };
  const declarations = `
attribute vec2 aPlumage;
uniform vec4 uPlumageRoots[${chains.length}], uPlumageDirections[${chains.length}];
uniform float uPlumageTime, uPlumageWind;
uniform vec3 uPlumageAir;
vec3 plumageOffset(vec3 p) {
  if (aPlumage.y <= 0.0 || uPlumageWind <= 0.0) return vec3(0.0);
  int i = int(aPlumage.x + 0.5);
  vec4 root = uPlumageRoots[i];
  vec3 direction = uPlumageDirections[i].xyz;
  vec3 axis = cross(direction, uPlumageAir);
  float strength = length(axis);
  if (strength < 0.0001) return vec3(0.0);
  float wave = 0.65 + 0.25 * sin(uPlumageTime * 2.3 + root.w) + 0.10 * sin(uPlumageTime * 5.1 + root.w * 0.7);
  return uPlumageAir * (aPlumage.y * uPlumageWind * min(1.0, strength) * wave);
}`;
  const patched = new WeakSet();
  function patchMaterial(material) {
    if (patched.has(material)) return material;
    patched.add(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${declarations}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += plumageOffset(position);');
    };
    const oldKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (oldKey ? oldKey() : '') + '|opening-back-plumage1-' + chains.length;
    material.needsUpdate = true;
    return material;
  }
  patchMaterial(mesh.material);
  // Keep the same tiny edge motion in both shadow types, without replacing any existing custom material patches.
  mesh.customDepthMaterial ??= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.customDistanceMaterial ??= new THREE.MeshDistanceMaterial();
  patchMaterial(mesh.customDepthMaterial); patchMaterial(mesh.customDistanceMaterial);
  const inverseWorld = new THREE.Matrix4(), localAir = uniforms.uPlumageAir.value;
  function update({ time, wind = 1, direction } = {}) {
    uniforms.uPlumageTime.value = Number.isFinite(time) ? time : 0;
    uniforms.uPlumageWind.value = clamp(Number.isFinite(wind) ? wind : 0, 0, 1);
    if (direction) {
      mesh.updateWorldMatrix(true, false);
      inverseWorld.copy(mesh.matrixWorld).invert();
      localAir.copy(direction).transformDirection(inverseWorld);
    }
  }

  // CPU equivalent of the vertex bend, for mesh-contact/strain diagnostics and deterministic verification.
  const p = new THREE.Vector3(), axis = new THREE.Vector3();
  function sample(index, target = new THREE.Vector3(), { time = uniforms.uPlumageTime.value, wind = uniforms.uPlumageWind.value } = {}) {
    target.fromBufferAttribute(position, index);
    const weight = attribute[index * 2 + 1];
    if (!weight || wind <= 0) return target;
    const chain = attribute[index * 2], root = roots[chain], direction = directions[chain];
    p.set(direction.x, direction.y, direction.z); axis.crossVectors(p, localAir);
    const strength = axis.length(); if (strength < 0.0001) return target;
    const wave = 0.65 + 0.25 * Math.sin(time * 2.3 + root.w) + 0.1 * Math.sin(time * 5.1 + root.w * 0.7);
    return target.addScaledVector(localAir, weight * clamp(wind, 0, 1) * Math.min(1, strength) * wave);
  }
  let active = 0; for (let i = 1; i < attribute.length; i += 2) if (attribute[i] > 0) active++;
  const api = {
    update, uniforms, patchMaterial, sample,
    createMaskMaterial() { return patchMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); },
    diagnostics: { sourceVertices: count, activeVertices: active, pinnedCopies: pinned, chains: chains.length, recoveredComponents: recovered, vertexCount: position.count, strainLimit: slope },
  };
  installed.set(mesh, api);
  return api;
}
