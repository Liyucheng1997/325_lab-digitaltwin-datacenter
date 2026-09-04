// ============================================================
//  服务器建模：外观 + 可抽出 + 内部结构拆解
//  本地坐标：原点在机箱中心，+z 为前面板方向
// ============================================================
import * as THREE from 'three';
import { RACK, ROLES, COMPONENTS } from './config.js';
import { std, glass, led, box, label, approach, easeInOut } from './util.js';

export const SRV = { w: 0.44, d: 0.75, pull: 0.85 };

const M = {
  body: std(0x353b46, { metalness: 0.7, roughness: 0.35 }),
  bodyAI: std(0x2b3340, { metalness: 0.7, roughness: 0.35 }),
  bezel: std(0x1b1f26, { metalness: 0.4, roughness: 0.6 }),
  bay: std(0x4b5563, { metalness: 0.6, roughness: 0.45 }),
  bayHandle: std(0x9ca3af, { metalness: 0.8, roughness: 0.3 }),
  frame: std(0x596273, { metalness: 0.8, roughness: 0.35 }),
  pcb: std(0x0d4b2e, { roughness: 0.75, metalness: 0.1 }),
  pcbDark: std(0x1e293b, { roughness: 0.7 }),
  alu: std(0xc3c9d2, { metalness: 0.9, roughness: 0.3 }),
  copper: std(0xb87333, { metalness: 0.9, roughness: 0.35 }),
  black: std(0x0f1115, { roughness: 0.8 }),
  dimm: std(0x14532d, { roughness: 0.6 }),
  dimmChip: std(0x111827, { roughness: 0.5 }),
  fanFrame: std(0x111318, { roughness: 0.7 }),
  blade: std(0x3b4657, { roughness: 0.6, side: THREE.DoubleSide }),
  psu: std(0x6b7280, { metalness: 0.7, roughness: 0.4 }),
  gpu: std(0x1f2937, { metalness: 0.5, roughness: 0.4 }),
  gold: std(0xd4a017, { metalness: 0.9, roughness: 0.3 }),
  glass: glass(0x9ec5ff, 0.18),
  cable: std(0xf97316, { roughness: 0.6 }),
  cableBlk: std(0x111111, { roughness: 0.7 }),
};

const STATUS_COLORS = { normal: 0x22c55e, warning: 0xf59e0b, fault: 0xef4444 };

export function createServer(spec) {
  const role = ROLES[spec.role];
  const H = spec.units * RACK.uH - 0.006;
  const { w: W, d: D } = SRV;
  const g = new THREE.Group();
  g.name = spec.id;
  const ud = (g.userData = {
    type: 'server', id: spec.id, spec, H,
    pull: 0, pullTarget: 0, explode: 0, explodeTarget: 0,
    parts: [], fans: [], built: false, baseZ: 0,
    state: { load: role.base, temp: 26, power: role.idle, status: 'normal', fault: false, netBlink: 0 },
  });

  // 封闭机箱
  const body = box(W, H, D - 0.02, spec.role === 'ai' ? M.bodyAI : M.body, 0, 0, -0.01);
  body.castShadow = true;
  g.add(body); ud.body = body;

  // 前面板框
  const front = new THREE.Group(); front.position.z = D / 2; g.add(front); ud.front = front;
  const plate = box(W, H, 0.01, M.bezel, 0, 0, 0.005);
  front.add(plate); ud.plate = plate;
  // 挂耳
  front.add(box(0.025, H, 0.012, M.frame, -W / 2 - 0.0125, 0, 0.004));
  front.add(box(0.025, H, 0.012, M.frame, W / 2 + 0.0125, 0, 0.004));

  // 硬盘托架（始终可见，抽出/拆解时可前滑）
  const disks = new THREE.Group();
  const isJbod = spec.role === 'jbod';
  const isAI = spec.role === 'ai';
  const rows = spec.units >= 4 ? (isAI ? 1 : 2) : 1;
  const cols = isAI ? 4 : 8;
  const bayH = spec.units >= 4 ? (isAI ? 0.06 : H * 0.42) : H * 0.72;
  const bayW = 0.046, bayL = 0.16;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = -((cols - 1) / 2) * 0.05 + i * 0.05 + (isAI ? -0.09 : 0);
      const y = rows === 1 ? (isAI ? -H / 2 + 0.05 : 0) : (r === 0 ? H * 0.24 : -H * 0.24);
      const carrier = box(bayW, bayH, bayL, M.bay, x, y, D / 2 - bayL / 2 + 0.008);
      carrier.add(box(bayW * 0.8, 0.004, 0.006, M.bayHandle, 0, bayH / 2 - 0.006, bayL / 2 + 0.002));
      const dled = box(0.004, 0.004, 0.003, led(0x22c55e), -bayW / 2 + 0.006, -bayH / 2 + 0.006, bayL / 2 + 0.002);
      dled.userData.isLed = true;
      carrier.add(dled);
      disks.add(carrier);
    }
  }
  g.add(disks);
  addPart(ud, disks, 'disk', isAI ? '前置 NVMe 盘' : `前置硬盘 ×${rows * cols}`, new THREE.Vector3(0, 0.10, 0.24));

  // GPU 服务器前面板大面积通风格栅
  if (isAI) {
    const vent = box(0.2, H * 0.8, 0.006, M.black, 0.1, 0, 0.01);
    front.add(vent);
  }

  // 状态 LED
  ud.ledMat = led(STATUS_COLORS.normal);
  const ledStatus = box(0.012, 0.012, 0.004, ud.ledMat, W / 2 - 0.02, H / 2 - 0.016, 0.012);
  ledStatus.userData.isLed = true;
  front.add(ledStatus);
  ud.ledNetMat = led(0x38bdf8, 0.2);
  const ledNet = box(0.012, 0.012, 0.004, ud.ledNetMat, W / 2 - 0.04, H / 2 - 0.016, 0.012);
  ledNet.userData.isLed = true;
  front.add(ledNet);

  return g;
}

function addPart(ud, obj, key, text, explode, opts = {}) {
  obj.userData = { type: 'component', key, name: text, server: null, ...opts };
  const lbl = label(text, 'part-label', 0, (opts.labelY ?? 0.03), 0);
  lbl.visible = false;
  obj.add(lbl);
  ud.parts.push({ obj, key, base: obj.position.clone(), explode, label: lbl });
  return obj;
}

function makeFan(size, depth = 0.032) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(size, size, depth), M.fanFrame);
  g.add(frame);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.46, size * 0.46, depth + 0.002, 20), M.black);
  hole.rotation.x = Math.PI / 2;
  g.add(hole);
  const rotor = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.14, size * 0.14, depth * 0.8, 12), M.blade);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, size * 0.11, 0.003), M.blade);
    b.position.x = size * 0.28;
    b.rotation.y = 0.6;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 7) * Math.PI * 2;
    pivot.add(b);
    rotor.add(pivot);
  }
  g.add(rotor);
  g.userData.rotor = rotor;
  return g;
}

function makeHeatsink(w, d, h, fins = 12) {
  const g = new THREE.Group();
  g.add(box(w, 0.006, d, M.copper, 0, 0.003, 0));
  const finT = 0.0016;
  for (let i = 0; i < fins; i++) {
    const z = -d / 2 + (i + 0.5) * (d / fins);
    g.add(box(w, h, finT, M.alu, 0, 0.006 + h / 2, z));
  }
  return g;
}

function makeCpu(H) {
  const g = new THREE.Group();
  g.add(box(0.078, 0.004, 0.078, M.pcbDark, 0, 0.002, 0));
  g.add(box(0.05, 0.004, 0.05, M.alu, 0, 0.006, 0));
  const hs = makeHeatsink(0.085, 0.085, Math.min(0.06, H - 0.03), 12);
  hs.position.y = 0.008;
  g.add(hs);
  return g;
}

function makeDimmBank(n, side) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const d = box(0.005, 0.03, 0.135, M.dimm, side * (0.052 + i * 0.011), 0.015, 0);
    for (let k = 0; k < 8; k++) d.add(box(0.0015, 0.01, 0.012, M.dimmChip, 0.0033 * side, 0.002, -0.06 + k * 0.017));
    g.add(d);
  }
  return g;
}

function makePsu(H) {
  const h = Math.min(0.04, H * 0.85);
  const g = new THREE.Group();
  g.add(box(0.074, h, 0.19, M.psu, 0, h / 2, 0));
  const l = box(0.006, 0.006, 0.003, led(0x22c55e), 0.025, h / 2 - 0.006, -0.096);
  l.userData.isLed = true;
  g.add(l);
  g.add(box(0.03, 0.03, 0.003, M.black, -0.012, h / 2, -0.096)); // 风扇格栅
  g.add(box(0.018, 0.012, 0.003, M.black, 0.025, 0.008, -0.096)); // 电源插口
  return g;
}

function makeCard(w, l, color = M.pcb, x = 0, z = 0) {
  const g = new THREE.Group();
  g.add(box(w, 0.0025, l, color, 0, 0, 0));
  g.add(box(0.012, 0.012, l * 0.5, M.black, 0, 0.008, 0)); // 芯片/散热
  g.add(box(w + 0.01, 0.02, 0.003, M.frame, 0, 0.01, -l / 2 - 0.002)); // 挡板
  g.position.set(x, 0, z);
  return g;
}

function makeGpu(x, z, H) {
  const g = new THREE.Group();
  const cardH = Math.min(0.10, H - 0.04);
  g.add(box(0.035, cardH, 0.26, M.gpu, 0, cardH / 2, 0));
  g.add(box(0.037, cardH * 0.4, 0.22, M.gold, 0, cardH * 0.55, 0));
  g.add(box(0.012, 0.004, 0.08, M.gold, 0, 0.002, 0.10)); // PCIe 金手指
  g.position.set(x, 0, z);
  return g;
}

function tube(points, mat, r = 0.0035) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r, 6, false), mat);
}

// 首次抽出时才构建内部结构，降低初始负载
export function buildInternals(g) {
  const ud = g.userData;
  if (ud.built) return;
  ud.built = true;
  const { H, spec } = ud;
  const { w: W, d: D } = SRV;
  const role = spec.role;
  const inner = new THREE.Group();
  inner.visible = false;
  g.add(inner);
  ud.inner = inner;
  const t = 0.004;
  const floorY = -H / 2 + t;

  // 开放式机箱
  inner.add(box(W, t, D - 0.02, M.body, 0, -H / 2 + t / 2, -0.01));
  inner.add(box(t, H, D - 0.02, M.body, -W / 2 + t / 2, 0, -0.01));
  inner.add(box(t, H, D - 0.02, M.body, W / 2 - t / 2, 0, -0.01));
  const rear = box(W, H, t, M.body, 0, 0, -D / 2 + t / 2);
  inner.add(rear);
  // 尾部端口
  rear.add(box(0.05, 0.012, 0.004, M.black, 0.05, H / 2 - 0.02, -0.004));
  rear.add(box(0.02, 0.012, 0.004, M.black, 0.11, H / 2 - 0.02, -0.004));

  const lid = box(W, t, D - 0.02, M.glass, 0, H / 2 - t / 2, -0.01);
  lid.userData.noHighlight = true;
  inner.add(lid);
  addPart(ud, lid, 'lid', COMPONENTS.lid.name, new THREE.Vector3(0, 0.34, -0.12));

  // 风扇墙
  const fanWall = new THREE.Group();
  const fanSize = spec.units >= 4 ? 0.08 : Math.min(0.06, H - 0.012);
  const nFan = spec.units >= 4 ? 4 : 5;
  const fanY = spec.units >= 4 ? -H / 2 + 0.05 : 0;
  for (let i = 0; i < nFan; i++) {
    const f = makeFan(fanSize);
    f.position.set(-((nFan - 1) / 2) * (fanSize + 0.006) + i * (fanSize + 0.006), fanY, 0);
    fanWall.add(f);
    ud.fans.push(f.userData.rotor);
  }
  fanWall.position.set(0, 0, D / 2 - 0.19);
  inner.add(fanWall);
  addPart(ud, fanWall, 'fan', `散热风扇 ×${nFan}`, new THREE.Vector3(0, 0.18, 0.05));

  // 硬盘背板
  if (role !== 'ai') {
    const bp = box(W - 0.02, H - 0.012, 0.003, M.pcb, 0, 0, D / 2 - 0.172);
    inner.add(bp);
    addPart(ud, bp, 'backplane', COMPONENTS.backplane.name, new THREE.Vector3(0, 0.12, 0.10));
  }

  if (role === 'jbod') {
    // JBOD：仅电源 + SAS 扩展器
    const sas = makeCard(0.12, 0.10, M.pcb, 0, -0.10);
    sas.position.y = floorY;
    inner.add(sas);
    addPart(ud, sas, 'sas', COMPONENTS.sas.name, new THREE.Vector3(0, 0.16, 0));
  } else {
    // 主板
    const mbW = 0.40, mbL = role === 'ai' ? 0.30 : 0.36;
    const mbZ = role === 'ai' ? -0.02 : -0.13;
    const mainboard = box(mbW, 0.003, mbL, M.pcb, 0, floorY + 0.0015, mbZ);
    // 芯片组 / BMC
    mainboard.add(box(0.025, 0.006, 0.025, M.black, 0.15, 0.004, mbL / 2 - 0.05));
    mainboard.add(box(0.015, 0.004, 0.015, M.black, -0.17, 0.004, mbL / 2 - 0.03));
    // VRM 电感
    for (let i = 0; i < 6; i++) mainboard.add(box(0.012, 0.01, 0.012, M.black, -0.16 + i * 0.016, 0.006, -mbL / 2 + 0.04));
    inner.add(mainboard);
    addPart(ud, mainboard, 'mainboard', COMPONENTS.mainboard.name, new THREE.Vector3(0, 0.06, 0));

    // CPU ×2 + 内存
    const cpuZ = role === 'ai' ? 0.06 : -0.08;
    const cpuGroup = new THREE.Group();
    for (const sx of [-1, 1]) {
      const cpu = makeCpu(H);
      cpu.position.set(sx * 0.105, floorY + 0.003, cpuZ);
      cpuGroup.add(cpu);
    }
    inner.add(cpuGroup);
    addPart(ud, cpuGroup, 'cpu', 'CPU ×2 + 散热片', new THREE.Vector3(0, 0.22, 0), { labelY: 0.08 });

    const dimmGroup = new THREE.Group();
    for (const sx of [-1, 1]) {
      const inner1 = makeDimmBank(4, -sx); // 靠中间
      inner1.position.set(sx * 0.105, floorY + 0.003, cpuZ);
      const outer = makeDimmBank(4, sx);
      outer.position.set(sx * 0.105, floorY + 0.003, cpuZ);
      dimmGroup.add(inner1, outer);
    }
    inner.add(dimmGroup);
    addPart(ud, dimmGroup, 'dimm', '内存 DIMM ×16', new THREE.Vector3(0, 0.15, 0), { labelY: 0.05 });

    if (role === 'ai') {
      const gpuGroup = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const gpu = makeGpu(-0.135 + i * 0.09, -0.20, H);
        gpu.position.y = floorY + 0.003;
        gpuGroup.add(gpu);
      }
      inner.add(gpuGroup);
      addPart(ud, gpuGroup, 'gpu', 'GPU 加速卡 ×4', new THREE.Vector3(0, 0.28, -0.02), { labelY: 0.12 });
      // NVLink 桥
      inner.add(box(0.30, 0.004, 0.02, M.gold, 0, floorY + 0.10, -0.25));
    } else {
      const nic = makeCard(0.10, 0.075, M.pcb, 0.12, -0.31);
      nic.position.y = floorY + 0.03;
      nic.add(box(0.03, 0.008, 0.006, M.black, 0.02, 0.014, -0.04)); // SFP 笼
      inner.add(nic);
      addPart(ud, nic, 'nic', COMPONENTS.nic.name, new THREE.Vector3(0.06, 0.20, -0.04), { labelY: 0.03 });

      const raid = makeCard(0.10, 0.075, M.pcb, -0.12, -0.31);
      raid.position.y = floorY + 0.03;
      inner.add(raid);
      addPart(ud, raid, 'raid', COMPONENTS.raid.name, new THREE.Vector3(-0.06, 0.20, -0.04), { labelY: 0.03 });

      // Riser 卡支架
      inner.add(box(0.008, 0.03, 0.08, M.pcbDark, 0.07, floorY + 0.015, -0.31));
      inner.add(box(0.008, 0.03, 0.08, M.pcbDark, -0.07, floorY + 0.015, -0.31));
    }
  }

  // 冗余电源 ×2（尾部两角）
  const psuGroup = new THREE.Group();
  for (const sx of [-1, 1]) {
    const p = makePsu(H);
    p.position.set(sx * (W / 2 - 0.045), floorY, -D / 2 + 0.11);
    psuGroup.add(p);
  }
  inner.add(psuGroup);
  addPart(ud, psuGroup, 'psu', '冗余电源 ×2 (A/B 路)', new THREE.Vector3(0, 0.12, -0.16), { labelY: 0.05 });

  // 线缆
  if (role !== 'jbod') {
    inner.add(tube([
      new THREE.Vector3(W / 2 - 0.045, floorY + 0.02, -D / 2 + 0.21),
      new THREE.Vector3(0.14, floorY + 0.035, -0.20),
      new THREE.Vector3(0.04, floorY + 0.03, -0.24),
    ], M.cable));
    inner.add(tube([
      new THREE.Vector3(-W / 2 + 0.045, floorY + 0.02, -D / 2 + 0.21),
      new THREE.Vector3(-0.14, floorY + 0.035, -0.20),
      new THREE.Vector3(-0.04, floorY + 0.03, -0.24),
    ], M.cable));
    inner.add(tube([
      new THREE.Vector3(0.17, floorY + 0.02, D / 2 - 0.18),
      new THREE.Vector3(0.19, floorY + 0.045, 0.0),
      new THREE.Vector3(-0.12, floorY + 0.045, -0.29),
    ], M.cableBlk, 0.0025));
  }

  for (const p of ud.parts) p.obj.userData.server = g;
}

export function setPulled(g, on) {
  const ud = g.userData;
  ud.pullTarget = on ? 1 : 0;
  if (on) buildInternals(g);
  if (!on) ud.explodeTarget = 0;
}
export function setExploded(g, on) {
  const ud = g.userData;
  if (on) { buildInternals(g); ud.pullTarget = 1; }
  ud.explodeTarget = on ? 1 : 0;
}

let _time = 0;
export function updateServer(g, dt) {
  _time += dt * 0.001;
  const ud = g.userData;
  const st = ud.state;

  if (ud.pull !== ud.pullTarget) {
    ud.pull = approach(ud.pull, ud.pullTarget, dt * 1.4);
    const e = easeInOut(ud.pull);
    g.position.z = ud.baseZ + e * SRV.pull;
    const open = ud.pull > 0.03;
    ud.body.visible = !open;
    if (ud.inner) ud.inner.visible = open;
  }

  if (ud.built && ud.explode !== ud.explodeTarget) {
    ud.explode = approach(ud.explode, ud.explodeTarget, dt * 1.2);
    const e = easeInOut(ud.explode);
    for (const p of ud.parts) {
      p.obj.position.copy(p.base).addScaledVector(p.explode, e);
      p.label.visible = e > 0.6;
    }
  }

  if (ud.inner && ud.inner.visible) {
    const spin = (st.load * 30 + 8 + (st.fault ? 25 : 0)) * dt;
    for (const r of ud.fans) r.rotation.z += spin;
  }

  // LED
  const target = STATUS_COLORS[st.status];
  if (ud.ledMat.color.getHex() !== target) { ud.ledMat.color.setHex(target); ud.ledMat.emissive.setHex(target); }
  ud.ledMat.emissiveIntensity = st.status === 'fault' ? (Math.sin(performance.now() * 0.012) > 0 ? 2.2 : 0.2) : 1.6;
  if (st.netBlink > 0) { st.netBlink -= dt; ud.ledNetMat.emissiveIntensity = 2.0; }
  else ud.ledNetMat.emissiveIntensity = Math.random() < st.load * 0.4 ? 1.6 : 0.2;
}

export function serverFrontWorld(g) {
  const c = g.localToWorld(new THREE.Vector3(0, 0, 0));
  const f = g.localToWorld(new THREE.Vector3(0, 0, SRV.d / 2));
  const dir = f.clone().sub(c).normalize();
  return { center: c, front: f, dir };
}
