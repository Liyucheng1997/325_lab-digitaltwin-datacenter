// ============================================================
//  流动可视化：网络报文、供电电流、冷/热气流粒子
// ============================================================
import * as THREE from 'three';
import { ROOM, RACK, COLD_AISLE } from './config.js';
import { polyline, dotTexture, rand, clamp } from './util.js';

const COLD = new THREE.Color(0x38bdf8);
const HOT = new THREE.Color(0xf97316);

export class Flows {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.layers = { net: true, pow: true, air: true };
    this.ambient = true;
    this.trafficScale = 1;

    // 静态链路线
    this.netLines = new THREE.Group();
    this.powLines = new THREE.Group();
    const lineOf = (pts, color, opacity) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.raycast = () => {};
      return l;
    };
    for (const { pts } of world.paths.net.values()) this.netLines.add(lineOf(pts, 0x38bdf8, 0.22));
    for (const { pts } of world.paths.pow.values()) this.powLines.add(lineOf(pts, 0xf59e0b, 0.16));
    for (const pts of Object.values(world.paths.core)) this.netLines.add(lineOf(pts, 0x38bdf8, 0.4));
    this.group.add(this.netLines, this.powLines);

    // 报文粒子
    this.MAX = 900;
    this.pos = new Float32Array(this.MAX * 3);
    this.col = new Float32Array(this.MAX * 3);
    this.sizes = new Float32Array(this.MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.tex = dotTexture();
    const mat = new THREE.PointsMaterial({ size: 0.14, map: this.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.group.add(this.points);
    this.packets = [];
    this.curveCache = new WeakMap();
    this.netTimer = 0;
    this.powTimer = 0;

    this.air = new Airflow(world, this.tex);
    this.group.add(this.air.points);
  }

  curveFor(pts) {
    let c = this.curveCache.get(pts);
    if (!c) { c = polyline(pts); c.len = c.getLength(); this.curveCache.set(pts, c); }
    return c;
  }

  // 发射一个粒子，返回 Promise（到达时 resolve）
  spawn(pts, { color = 0x38bdf8, speed = 3, reverse = false, layer = 'net', onArrive } = {}) {
    const c = this.curveFor(pts);
    return new Promise((resolve) => {
      if (this.packets.length >= this.MAX) { resolve(); return; }
      this.packets.push({ curve: c, t: reverse ? 1 : 0, dir: reverse ? -1 : 1, speed: speed / Math.max(0.01, c.len), color: new THREE.Color(color), layer, onArrive: () => { onArrive?.(); resolve(); } });
    });
  }

  burst(pts, opts = {}, n = 5, gap = 0.12) {
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(new Promise((r) => setTimeout(() => this.spawn(pts, opts).then(r), i * gap * 1000)));
    return Promise.all(ps);
  }

  setLayer(name, on) {
    this.layers[name] = on;
    this.netLines.visible = this.layers.net;
    this.powLines.visible = this.layers.pow;
    this.air.points.visible = this.layers.air;
  }

  update(dt) {
    const world = this.world;
    if (this.ambient) {
      this.netTimer -= dt;
      if (this.netTimer <= 0 && this.layers.net) {
        // 按负载加权随机选一台服务器
        const servers = world.servers;
        let total = 0;
        for (const s of servers) total += s.userData.state.load;
        let r = Math.random() * total;
        let target = servers[0];
        for (const s of servers) { r -= s.userData.state.load; if (r <= 0) { target = s; break; } }
        const p = world.paths.net.get(target.userData.id);
        this.spawn(p.pts, { color: 0x38bdf8, speed: 4 + Math.random() * 2, onArrive: () => {
          target.userData.state.netBlink = 0.25;
          const nd = target.userData.rack.userData.tor; if (nd) nd.userData.state.throughput += 1;
          this.spawn(p.pts, { color: 0xa78bfa, speed: 4 + Math.random() * 2, reverse: true });
        } });
        this.netTimer = (0.06 + Math.random() * 0.12) / this.trafficScale;
      }
      this.powTimer -= dt;
      if (this.powTimer <= 0 && this.layers.pow) {
        for (const s of world.servers) {
          if (Math.random() < 0.18 + s.userData.state.load * 0.2) this.spawn(world.paths.pow.get(s.userData.id).pts, { color: 0xf59e0b, speed: 2.2, layer: 'pow' });
        }
        this.powTimer = 0.7;
      }
    }

    let n = 0;
    const keep = [];
    for (const p of this.packets) {
      p.t += p.dir * p.speed * dt;
      if (p.t > 1 || p.t < 0) { p.onArrive(); continue; }
      keep.push(p);
      if (!this.layers[p.layer]) continue;
      const v = p.curve.getPointAt(clamp(p.t, 0, 1));
      this.pos[n * 3] = v.x; this.pos[n * 3 + 1] = v.y; this.pos[n * 3 + 2] = v.z;
      this.col[n * 3] = p.color.r; this.col[n * 3 + 1] = p.color.g; this.col[n * 3 + 2] = p.color.b;
      n++;
    }
    this.packets = keep;
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    if (this.layers.air) this.air.update(dt);
  }
}

// ---------------- 气流粒子 ----------------
class Airflow {
  constructor(world, tex) {
    this.world = world;
    this.N = 900;
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.phase = new Uint8Array(this.N);
    this.targetY = new Float32Array(this.N);
    this.side = new Int8Array(this.N);
    this.crac = new Int8Array(this.N);
    this.speed = new Float32Array(this.N);
    this.region = world.tileRegion;
    this.front = COLD_AISLE.halfWidth;
    this.back = COLD_AISLE.halfWidth + RACK.d;
    this.ceiling = ROOM.h - 0.35;
    this.cracs = world.cracs.map((c) => c.userData);
    this.cracFan = 0.65;
    this.tmp = new THREE.Color();
    for (let i = 0; i < this.N; i++) { this.reset(i); this.warm(i); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.09, map: tex, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
  }

  reset(i) {
    const { xmin, xmax } = this.region;
    this.pos[i * 3] = rand(xmin, xmax);
    this.pos[i * 3 + 1] = 0.02;
    this.pos[i * 3 + 2] = rand(-0.8, 0.8);
    this.phase[i] = 0;
    this.targetY[i] = rand(0.25, RACK.h - 0.1);
    this.side[i] = Math.random() < 0.5 ? -1 : 1;
    this.speed[i] = rand(0.8, 1.2);
    this.setColor(i, COLD);
  }
  // 随机推进到某个阶段，避免启动时全部从地板出发
  warm(i) {
    const p = Math.floor(Math.random() * 5);
    const s = this.side[i];
    this.phase[i] = p;
    if (p >= 1) this.pos[i * 3 + 1] = this.targetY[i];
    if (p === 1) this.pos[i * 3 + 2] = s * rand(0, this.front);
    if (p === 2) { this.pos[i * 3 + 2] = s * rand(this.front, this.back); this.setColor(i, this.tmp.copy(COLD).lerp(HOT, 0.5)); }
    if (p === 3) { this.pos[i * 3 + 2] = s * rand(this.back, this.back + 0.6); this.pos[i * 3 + 1] = rand(1, this.ceiling); this.setColor(i, HOT); }
    if (p === 4) { this.pickCrac(i); this.pos[i * 3 + 1] = this.ceiling; this.pos[i * 3 + 2] = s * rand(this.back, 6); this.setColor(i, HOT); }
  }
  setColor(i, c) { this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b; }
  pickCrac(i) {
    const s = this.side[i], x = this.pos[i * 3];
    let best = -1, bd = 1e9;
    this.cracs.forEach((c, k) => { if (Math.sign(c.z) !== s || !c.state.on) return; const d = Math.abs(c.x - x); if (d < bd) { bd = d; best = k; } });
    if (best < 0) best = this.cracs.findIndex((c) => c.state.on);
    this.crac[i] = Math.max(0, best);
  }

  update(dt) {
    const P = this.pos, N = this.N;
    const fan = this.cracFan;
    const v = 0.55 + fan * 0.6;
    for (let i = 0; i < N; i++) {
      const ix = i * 3, iy = ix + 1, iz = ix + 2;
      const s = this.side[i], sp = this.speed[i] * v;
      switch (this.phase[i]) {
        case 0: // 地板送风上升
          P[iy] += 0.7 * sp * dt; P[ix] += (Math.random() - 0.5) * 0.05 * dt;
          if (P[iy] >= this.targetY[i]) this.phase[i] = 1;
          break;
        case 1: // 进入机柜前面板
          P[iz] += s * 0.6 * sp * dt;
          if (Math.abs(P[iz]) >= this.front) this.phase[i] = 2;
          break;
        case 2: { // 穿过服务器，吸热
          P[iz] += s * 0.75 * sp * dt;
          const k = clamp((Math.abs(P[iz]) - this.front) / RACK.d, 0, 1);
          this.setColor(i, this.tmp.copy(COLD).lerp(HOT, k));
          if (Math.abs(P[iz]) >= this.back) { this.phase[i] = 3; this.setColor(i, HOT); }
          break;
        }
        case 3: // 热通道上升
          P[iy] += 0.6 * sp * dt; P[iz] += s * 0.25 * sp * dt; P[ix] += (Math.random() - 0.5) * 0.1 * dt;
          if (P[iy] >= this.ceiling) { this.phase[i] = 4; this.pickCrac(i); }
          break;
        case 4: { // 吊顶回风至空调
          const c = this.cracs[this.crac[i]];
          const dx = c.x - P[ix], dz = c.z - P[iz];
          const d = Math.hypot(dx, dz);
          const step = 1.3 * sp * dt;
          if (d < step + 0.05) { this.phase[i] = 5; }
          else { P[ix] += (dx / d) * step; P[iz] += (dz / d) * step; }
          break;
        }
        case 5: // 进入空调顶部回风口，降温
          P[iy] -= 1.2 * sp * dt;
          this.setColor(i, this.tmp.copy(HOT).lerp(COLD, clamp((this.ceiling - P[iy]) / (this.ceiling - 2.0), 0, 1)));
          if (P[iy] <= 2.0) this.reset(i);
          break;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
