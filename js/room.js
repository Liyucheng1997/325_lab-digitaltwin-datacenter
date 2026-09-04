// ============================================================
//  机房建模：房间、地板、机柜、网络设备、供配电、空调、桥架、路径
// ============================================================
import * as THREE from 'three';
import { ROOM, RACK, ROWS, RACKS_PER_ROW, rackX, CORE_RACK, PROFILES, ROLES, UPS_X, CRACS, LEVELS, COLD_AISLE, NET_KINDS, EQUIP } from './config.js';
import { createServer, SRV } from './server.js';
import { std, glass, led, box, label, portTexture, tileTexture, grilleTexture } from './util.js';

const MAT = {
  slab: std(0x1a2230, { roughness: 0.9, metalness: 0.1 }),
  wall: glass(0x38bdf8, 0.05),
  rackPost: std(0x252a33, { metalness: 0.7, roughness: 0.4 }),
  rackSide: new THREE.MeshStandardMaterial({ color: 0x1f242c, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.9 }),
  rackDoor: new THREE.MeshStandardMaterial({ color: 0x151920, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.55 }),
  rail: std(0x6b7280, { metalness: 0.8, roughness: 0.3 }),
  blank: std(0x20252e, { metalness: 0.5, roughness: 0.6 }),
  pdu: std(0x0b0d12, { roughness: 0.7 }),
  tray: new THREE.MeshStandardMaterial({ color: 0x8b95a5, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.7 }),
  busway: std(0xd97706, { metalness: 0.4, roughness: 0.5 }),
  cabinet: std(0x2a3140, { metalness: 0.5, roughness: 0.45 }),
  cabinetDark: std(0x1f2531, { metalness: 0.5, roughness: 0.45 }),
  cracBody: std(0xe2e8f0, { metalness: 0.2, roughness: 0.5 }),
  cracTrim: std(0x94a3b8, { metalness: 0.6, roughness: 0.4 }),
  glassRoof: glass(0x7dd3fc, 0.14),
  lightBar: led(0xf8fafc, 0.9),
  fanDark: std(0x334155, { roughness: 0.6, side: THREE.DoubleSide }),
};

const uY = (u, units) => RACK.base + (u - 1) * RACK.uH + (units * RACK.uH) / 2;

export function buildRoom(scene) {
  const world = {
    group: new THREE.Group(),
    servers: [], racks: [], netdevs: [], equipment: [], cracs: [], tiles: [],
    byId: new Map(),
    paths: { net: new Map(), pow: new Map(), core: {} },
    zoneLabels: [], rackLabels: [],
    containment: null,
    tileRegion: { xmin: 0, xmax: 0, zmax: COLD_AISLE.halfWidth },
    uY,
  };
  buildShell(world);
  buildFloor(world);
  ROWS.forEach((row) => {
    for (let i = 0; i < RACKS_PER_ROW; i++) {
      buildRack(world, { id: `${row.id}${i + 1}`, x: rackX(i), z: row.z, facing: row.facing, row: row.id, index: i, profile: row.profile[i], kind: 'server' });
    }
  });
  buildCoreRack(world);
  buildPower(world);
  buildCracs(world);
  buildTrays(world);
  world.group.updateMatrixWorld(true);
  buildPaths(world);
  buildZoneLabels(world);
  scene.add(world.group);
  return world;
}

function register(world, obj) {
  world.byId.set(obj.userData.id, obj);
}

// ---------- 房间外壳 ----------
function buildShell(world) {
  const { w, d, h } = ROOM;
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.slab);
  slab.rotation.x = -Math.PI / 2;
  slab.receiveShadow = true;
  slab.userData = { type: 'floor', id: 'FLOOR', name: '架空地板' };
  world.group.add(slab);

  // 地板格线 0.6m
  const pts = [];
  for (let x = -w / 2; x <= w / 2 + 0.001; x += 0.6) pts.push(x, 0.002, -d / 2, x, 0.002, d / 2);
  for (let z = -d / 2; z <= d / 2 + 0.001; z += 0.6) pts.push(-w / 2, 0.002, z, w / 2, 0.002, z);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x2c3646, transparent: true, opacity: 0.8 }));
  grid.raycast = () => {};
  world.group.add(grid);

  // 墙体（半透明）+ 边框
  const walls = [
    { w: w, h, x: 0, z: -d / 2, ry: 0 }, { w: w, h, x: 0, z: d / 2, ry: Math.PI },
    { w: d, h, x: -w / 2, z: 0, ry: Math.PI / 2 }, { w: d, h, x: w / 2, z: 0, ry: -Math.PI / 2 },
  ];
  for (const s of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), MAT.wall);
    m.position.set(s.x, h / 2, s.z); m.rotation.y = s.ry;
    m.raycast = () => {};
    world.group.add(m);
  }
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 }));
  edges.position.y = h / 2;
  edges.raycast = () => {};
  world.group.add(edges);

  // 顶部照明灯带
  for (const z of [-3.6, 0, 3.6]) {
    const bar = box(12, 0.04, 0.12, MAT.lightBar, -1.5, h - 0.08, z);
    bar.userData = { type: 'equip', kind: 'light', id: `LIGHT${z}`, name: 'LED 照明灯带' };
    world.group.add(bar);
  }
}

// ---------- 地板：穿孔地板 + 冷通道封闭 ----------
function buildFloor(world) {
  const tex = tileTexture();
  const tileMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.2 });
  const xmin = rackX(0) - 0.3, xmax = rackX(RACKS_PER_ROW - 1) + 0.3;
  world.tileRegion.xmin = xmin; world.tileRegion.xmax = xmax;
  const tiles = new THREE.Group();
  for (let x = xmin + 0.3; x < xmax; x += 0.6) {
    for (const z of [-0.6, 0, 0.6]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), tileMat);
      t.rotation.x = -Math.PI / 2;
      t.position.set(x, 0.004, z);
      t.userData = { type: 'equip', kind: 'tile', id: `TILE${x.toFixed(1)}_${z}`, name: '穿孔送风地板' };
      tiles.add(t);
      world.tiles.push(t);
    }
  }
  world.group.add(tiles);

  // 冷通道封闭：顶板 + 端门
  const len = xmax - xmin;
  const cont = new THREE.Group();
  const roof = box(len, 0.02, COLD_AISLE.halfWidth * 2, MAT.glassRoof, (xmin + xmax) / 2, RACK.h + 0.03, 0);
  cont.add(roof);
  for (const x of [xmin, xmax]) {
    const door = box(0.02, RACK.h, COLD_AISLE.halfWidth * 2, MAT.glassRoof, x, RACK.h / 2, 0);
    cont.add(door);
  }
  const frameMat = std(0x64748b, { metalness: 0.7 });
  for (const x of [xmin, xmax]) for (const z of [-COLD_AISLE.halfWidth, COLD_AISLE.halfWidth]) cont.add(box(0.04, RACK.h, 0.04, frameMat, x, RACK.h / 2, z));
  cont.userData = { type: 'equip', kind: 'containment', id: 'CONTAINMENT', name: '冷通道封闭' };
  cont.traverse((o) => { if (o.isMesh) o.userData.noHighlight = true; });
  world.group.add(cont);
  world.containment = cont;
}

// ---------- 机柜 ----------
function buildRack(world, r) {
  const { w, d, h } = RACK;
  const g = new THREE.Group();
  g.position.set(r.x, 0, r.z);
  g.rotation.y = r.kind === 'network' ? -Math.PI / 2 : (r.facing === 1 ? 0 : Math.PI);
  g.userData = { type: 'rack', id: r.id, name: `机柜 ${r.id}`, profile: r.profile, servers: [], netdevs: [], facing: r.facing, row: r.row, x: r.x, z: r.z };

  // 底座 + 顶板 + 立柱
  g.add(box(w, RACK.base, d, MAT.rackPost, 0, RACK.base / 2, 0));
  g.add(box(w, 0.03, d, MAT.rackPost, 0, h + 0.015, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, h, 0.04, MAT.rackPost, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02)));
  // 侧板
  for (const sx of [-1, 1]) g.add(box(0.01, h - 0.1, d - 0.08, MAT.rackSide, sx * (w / 2 - 0.005), h / 2 + 0.02, 0));
  // 后门（网孔）
  g.add(box(w - 0.08, h - 0.1, 0.01, MAT.rackDoor, 0, h / 2 + 0.02, -(d / 2 - 0.005)));
  // 前部安装导轨
  for (const sx of [-1, 1]) g.add(box(0.03, h - 0.16, 0.02, MAT.rail, sx * (w / 2 - 0.06), h / 2 + 0.04, 0.31));

  // 空 U 位假面板
  const occupied = new Set();
  const profile = PROFILES[r.profile];
  for (const s of profile.slots) for (let k = 0; k < s.units; k++) occupied.add(s.u + k);
  if (r.kind === 'server') occupied.add(42);

  // ToR 交换机
  if (r.kind === 'server') {
    const tor = createNetDevice({ id: `${r.id}-TOR`, name: `ToR 交换机 ${r.id}`, kind: 'tor', units: 1, rack: r.id });
    tor.position.set(0, uY(42, 1), 0.31 - 0.225);
    g.add(tor);
    g.userData.tor = tor;
    world.netdevs.push(tor);
    register(world, tor);
  }

  // PDU（A/B 路，后部两侧）
  for (const [sx, ab] of [[1, 'A'], [-1, 'B']]) {
    const pdu = new THREE.Group();
    pdu.add(box(0.045, 1.7, 0.045, MAT.pdu, 0, 0, 0));
    for (let i = 0; i < 12; i++) {
      const o = box(0.02, 0.012, 0.004, led(ab === 'A' ? 0xf59e0b : 0x38bdf8, 0.9), 0, -0.75 + i * 0.13, 0.024);
      o.userData.isLed = true;
      pdu.add(o);
    }
    pdu.position.set(sx * (w / 2 - 0.08), 1.05, -d / 2 + 0.12);
    pdu.userData = { type: 'equip', kind: 'pdu', id: `${r.id}-PDU-${ab}`, name: `机柜 PDU ${ab} 路 (${r.id})`, rack: g };
    g.add(pdu);
    if (ab === 'A') g.userData.pdu = pdu;
    register(world, pdu);
  }

  // 服务器
  for (const s of profile.slots) {
    const role = ROLES[s.role];
    const idx = g.userData.servers.length + 1;
    const spec = {
      id: `${role.prefix}-${r.id}-${String(idx).padStart(2, '0')}`,
      rack: r.id, u: s.u, units: s.units, role: s.role,
      ip: `10.${r.row === 'A' ? 1 : 2}.${r.index + 1}.${s.u}`,
      sn: `SN${(r.row.charCodeAt(0) * 7 + r.index * 13 + s.u * 3).toString(16).toUpperCase().padStart(6, '0')}`,
    };
    const srv = createServer(spec);
    srv.position.set(0, uY(s.u, s.units), 0.31 - SRV.d / 2);
    srv.userData.baseZ = srv.position.z;
    srv.userData.rack = g;
    g.add(srv);
    g.userData.servers.push(srv);
    world.servers.push(srv);
    register(world, srv);
  }

  // 假面板
  for (let u = 1; u <= 42; u++) {
    if (r.kind !== 'server' || occupied.has(u)) continue;
    if (u < 4 || Math.random() < 0.55) continue;
    g.add(box(w - 0.1, RACK.uH - 0.006, 0.006, MAT.blank, 0, uY(u, 1), 0.31));
  }

  const lbl = label(r.id, 'rack-label', 0, h + 0.18, 0);
  g.add(lbl);
  world.rackLabels.push(lbl);

  world.group.add(g);
  world.racks.push(g);
  register(world, g);
  return g;
}

// ---------- 网络设备 ----------
const portTexCache = {};
function createNetDevice({ id, name, kind, units, rack }) {
  const k = NET_KINDS[kind];
  const H = units * RACK.uH - 0.006;
  const g = new THREE.Group();
  const body = box(0.44, H, 0.45, std(k.color, { metalness: 0.6, roughness: 0.4 }));
  body.castShadow = true;
  g.add(body);
  if (!portTexCache[kind]) portTexCache[kind] = portTexture(k.ports);
  const faceMat = new THREE.MeshStandardMaterial({ map: portTexCache[kind], emissiveMap: portTexCache[kind], emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, Math.min(H, 0.06)), faceMat);
  face.position.z = 0.2255;
  face.userData.isLed = true;
  g.add(face);
  for (const sx of [-1, 1]) g.add(box(0.025, H, 0.012, MAT.rail, sx * 0.2325, 0, 0.222));
  g.userData = { type: 'netdev', id, name, kind, rack, faceMat, state: { throughput: 0, cpu: 0.1, ports: k.ports, up: Math.round(k.ports * 0.6) } };
  return g;
}

function buildCoreRack(world) {
  const g = buildRack(world, { id: CORE_RACK.id, x: CORE_RACK.x, z: CORE_RACK.z, facing: 1, row: 'C', index: 0, profile: 'network', kind: 'network' });
  g.userData.name = '核心网络机柜';
  const devs = [
    { id: 'PATCH', name: '光纤配线架', kind: 'patch', units: 1, u: 42 },
    { id: 'ROUTER', name: '出口路由器', kind: 'router', units: 2, u: 39 },
    { id: 'FW', name: '防火墙', kind: 'firewall', units: 1, u: 37 },
    { id: 'CORE-1', name: '核心交换机 1', kind: 'core', units: 2, u: 34 },
    { id: 'CORE-2', name: '核心交换机 2', kind: 'core', units: 2, u: 31 },
    { id: 'OOB', name: '带外管理交换机', kind: 'oob', units: 1, u: 28 },
  ];
  for (const d of devs) {
    const dev = createNetDevice({ id: d.id, name: d.name, kind: d.kind, units: d.units, rack: 'CORE' });
    dev.position.set(0, uY(d.u, d.units), 0.31 - 0.225);
    g.add(dev);
    g.userData.netdevs.push(dev);
    world.netdevs.push(dev);
    register(world, dev);
  }
  world.coreRack = g;
}

// ---------- 供配电 ----------
function cabinet(world, { id, name, kind, x, z, w = 0.8, color = MAT.cabinet, extra }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI / 2; // 面朝 +x
  const body = box(w, 2.0, 0.9, color, 0, 1.0, 0);
  body.castShadow = true;
  g.add(body);
  g.add(box(w, 0.06, 0.9, MAT.rackPost, 0, 0.03, 0));
  // 显示屏
  const scr = box(0.22, 0.12, 0.005, led(0x22c55e, 0.7), 0, 1.6, 0.453);
  scr.userData.isLed = true;
  g.add(scr);
  g.userData = { type: 'equip', kind, id, name, screen: scr.material, state: {} };
  extra?.(g);
  world.group.add(g);
  world.equipment.push(g);
  register(world, g);
  const l = label(name, 'equip-label', 0, 2.25, 0);
  g.add(l);
  world.rackLabels.push(l);
  return g;
}

function buildPower(world) {
  const ventMat = std(0x0f1319);
  const vents = (g, y0 = 0.4, n = 6) => { for (let i = 0; i < n; i++) g.add(box(0.5, 0.02, 0.004, ventMat, 0, y0 + i * 0.06, 0.452)); };
  world.ups = [];
  world.ups.push(cabinet(world, { id: 'UPS-1', name: 'UPS-1 (A 路)', kind: 'ups', x: UPS_X, z: -3.4, extra: vents }));
  world.ups.push(cabinet(world, { id: 'UPS-2', name: 'UPS-2 (B 路)', kind: 'ups', x: UPS_X, z: -1.8, extra: vents }));
  for (const u of world.ups) u.userData.state = { load: 0, battery: 100, onBattery: false, runtime: 15, inputV: 380, outputV: 380 };
  const batExtra = (g) => { for (let r = 0; r < 4; r++) g.add(box(0.7, 0.03, 0.004, MAT.cabinetDark, 0, 0.35 + r * 0.4, 0.452)); };
  cabinet(world, { id: 'BAT-1', name: '电池柜 1', kind: 'battery', x: UPS_X, z: 0.2, w: 1.0, color: MAT.cabinetDark, extra: batExtra });
  cabinet(world, { id: 'BAT-2', name: '电池柜 2', kind: 'battery', x: UPS_X, z: 1.8, w: 1.0, color: MAT.cabinetDark, extra: batExtra });
  const pdcExtra = (g) => {
    for (let i = 0; i < 8; i++) {
      const b = box(0.05, 0.08, 0.02, i < 6 ? led(0x22c55e, 0.5) : std(0x64748b), -0.28 + i * 0.08, 1.15, 0.455);
      b.userData.isLed = true;
      g.add(b);
    }
  };
  world.pdc = cabinet(world, { id: 'PDC', name: '低压配电柜', kind: 'pdc', x: UPS_X, z: 3.6, w: 1.0, extra: pdcExtra });

  // 母线槽：PDC → 立管 → z 向干线 → 两条 x 向支线（分别在两排机柜后部上方）
  const bw = 0.14;
  const yB = LEVELS.busway;
  const busGroup = new THREE.Group();
  busGroup.userData = { type: 'equip', kind: 'busway', id: 'BUSWAY', name: '架空母线槽' };
  busGroup.add(box(bw, yB - 2.0, bw, MAT.busway, UPS_X, 2.0 + (yB - 2.0) / 2, 3.6)); // 立管
  const zA = ROWS[0].z - ROWS[0].facing * 0.35, zB = ROWS[1].z - ROWS[1].facing * 0.35;
  busGroup.add(box(bw, bw, 3.6 - zA + bw, MAT.busway, UPS_X, yB, (3.6 + zA) / 2)); // z 向干线
  const xEnd = CORE_RACK.x + 0.3;
  for (const z of [zA, zB]) busGroup.add(box(xEnd - UPS_X, bw, bw, MAT.busway, (xEnd + UPS_X) / 2, yB, z));
  // 每个机柜的插接箱 + 下引线
  for (const rack of world.racks) {
    const ud = rack.userData;
    const z = ud.id === 'CORE' ? zA : (ud.z - ud.facing * 0.35);
    const x = ud.id === 'CORE' ? xEnd : ud.x;
    busGroup.add(box(0.2, 0.18, 0.2, MAT.cabinetDark, x, yB - 0.1, z));
    busGroup.add(box(0.03, yB - 0.2 - RACK.h, 0.03, MAT.pdu, x, (yB - 0.1 + RACK.h) / 2, z));
  }
  busGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  world.group.add(busGroup);
  world.busway = busGroup;
  world.equipment.push(busGroup);
  register(world, busGroup);
  world.busZ = { A: zA, B: zB };
}

// ---------- 精密空调 ----------
function buildCracs(world) {
  const grille = grilleTexture();
  const grilleMat = new THREE.MeshStandardMaterial({ map: grille, roughness: 0.7 });
  for (const c of CRACS) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.facing === 1 ? 0 : Math.PI;
    const body = box(2.4, 2.0, 0.9, MAT.cracBody, 0, 1.0, 0);
    body.castShadow = true;
    g.add(body);
    g.add(box(2.4, 0.08, 0.9, MAT.cracTrim, 0, 0.04, 0));
    g.add(box(2.4, 0.05, 0.9, MAT.cracTrim, 0, 2.0, 0));
    // 顶部回风口
    const topGrille = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.7), grilleMat);
    topGrille.position.set(0, 2.03, 0);
    topGrille.rotation.x = -Math.PI / 2;
    g.add(topGrille);
    // 前部风机可视窗
    const fans = [];
    for (const x of [-0.7, 0.7]) {
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), std(0x0b0d12));
      win.position.set(x, 0.55, 0.452);
      g.add(win);
      const rotor = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.01), MAT.fanDark);
        b.position.x = 0.17; b.rotation.y = 0.5;
        const p = new THREE.Group(); p.rotation.z = (i / 9) * Math.PI * 2; p.add(b);
        rotor.add(p);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), MAT.fanDark);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      rotor.position.set(x, 0.55, 0.46);
      g.add(rotor);
      fans.push(rotor);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 8, 32), MAT.cracTrim);
      ring.position.set(x, 0.55, 0.455);
      g.add(ring);
    }
    // 显示屏 + 过滤网格栅
    const scr = box(0.4, 0.22, 0.006, led(0x38bdf8, 0.6), 0, 1.55, 0.453);
    scr.userData.isLed = true;
    g.add(scr);
    const frontGrille = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.5), grilleMat);
    frontGrille.position.set(0, 1.15, 0.452);
    g.add(frontGrille);
    g.userData = { type: 'equip', kind: 'crac', id: c.id, name: `精密空调 ${c.id}`, fans, screen: scr.material, x: c.x, z: c.z, facing: c.facing, state: { supply: 18, ret: 30, fan: 65, power: 9, on: true } };
    const cl = label(c.id, 'equip-label', 0, 2.3, 0);
    g.add(cl);
    world.rackLabels.push(cl);
    world.group.add(g);
    world.cracs.push(g);
    world.equipment.push(g);
    register(world, g);
  }
}

// ---------- 网络桥架 ----------
function buildTrays(world) {
  const yT = LEVELS.tray;
  const tray = new THREE.Group();
  tray.userData = { type: 'equip', kind: 'tray', id: 'TRAY', name: '网络桥架' };
  const xStart = rackX(0) - 0.4, xCore = CORE_RACK.x;
  world.trayZ = {};
  for (const row of ROWS) {
    const z = row.z - row.facing * 0.12;
    world.trayZ[row.id] = z;
    tray.add(box(xCore - xStart, 0.05, 0.3, MAT.tray, (xCore + xStart) / 2, yT, z));
    // 侧边
    for (const sz of [-1, 1]) tray.add(box(xCore - xStart, 0.1, 0.01, MAT.tray, (xCore + xStart) / 2, yT + 0.03, z + sz * 0.15));
  }
  const zA = world.trayZ.A, zB = world.trayZ.B;
  tray.add(box(0.3, 0.05, zB - zA + 0.3, MAT.tray, xCore, yT, 0));
  // 核心机柜上方竖向下引
  tray.add(box(0.3, yT - RACK.h, 0.05, MAT.tray, xCore, (yT + RACK.h) / 2, -0.15));
  // 每个机柜上方下引线束
  for (const rack of world.racks) {
    const ud = rack.userData;
    if (ud.id === 'CORE') continue;
    tray.add(box(0.06, yT - RACK.h - 0.03, 0.06, MAT.pdu, ud.x, (yT + RACK.h) / 2, world.trayZ[ud.row]));
  }
  world.group.add(tray);
  world.tray = tray;
  world.equipment.push(tray);
  register(world, tray);
}

// ---------- 路径（网络 / 供电） ----------
function buildPaths(world) {
  const wp = (obj, x, y, z) => obj.localToWorld(new THREE.Vector3(x, y, z));
  const core1 = world.byId.get('CORE-1');
  const coreFront = wp(core1, 0, 0, 0.26);
  const coreTop = new THREE.Vector3(CORE_RACK.x, LEVELS.tray, -0.15);
  const yT = LEVELS.tray;

  // 核心机柜内部：互联网 → 路由器 → 防火墙 → 核心
  const router = world.byId.get('ROUTER'), fw = world.byId.get('FW');
  world.paths.core = {
    internet: [new THREE.Vector3(CORE_RACK.x - 0.6, ROOM.h - 0.2, 0), new THREE.Vector3(CORE_RACK.x - 0.6, RACK.h + 0.2, 0), wp(router, 0, 0, 0.26)],
    routerToFw: [wp(router, 0, 0, 0.26), wp(router, 0, 0, 0.4), wp(fw, 0, 0, 0.4), wp(fw, 0, 0, 0.26)],
    fwToCore: [wp(fw, 0, 0, 0.26), wp(fw, 0, 0, 0.4), wp(core1, 0, 0, 0.4), coreFront],
  };

  for (const srv of world.servers) {
    const rack = srv.userData.rack;
    const rud = rack.userData;
    const zTray = world.trayZ[rud.row];
    const tor = rud.tor;
    const torRear = wp(tor, 0, 0, -0.2);
    const pts = [
      coreFront,
      new THREE.Vector3(CORE_RACK.x - 0.35, coreFront.y, 0),
      new THREE.Vector3(CORE_RACK.x - 0.35, yT, 0),
      new THREE.Vector3(CORE_RACK.x, yT, zTray),
      new THREE.Vector3(rud.x, yT, zTray),
      new THREE.Vector3(rud.x, RACK.h + 0.02, zTray),
      torRear,
      wp(rack, 0, srv.position.y + 0.02, -0.28),
      wp(srv, 0.12, 0, -SRV.d / 2 + 0.02),
    ];
    world.paths.net.set(srv.userData.id, { pts, torIdx: 6 });

    // 供电：UPS → 母线 → 插接箱 → PDU → PSU
    const ups = world.ups[rud.row === 'A' ? 0 : 1];
    const upsTop = wp(ups, 0, 2.0, 0);
    const zBus = rud.row === 'A' ? world.busZ.A : world.busZ.B;
    const pdu = rud.pdu;
    const pduTop = wp(pdu, 0, 0.85, 0);
    const ppts = [
      upsTop,
      new THREE.Vector3(UPS_X, LEVELS.busway, upsTop.z),
      new THREE.Vector3(UPS_X, LEVELS.busway, zBus),
      new THREE.Vector3(rud.x, LEVELS.busway, zBus),
      new THREE.Vector3(rud.x, RACK.h, zBus),
      pduTop,
      wp(pdu, 0, srv.position.y - 1.05, 0.03),
      wp(srv, SRV.w / 2 - 0.045, 0, -SRV.d / 2 + 0.02),
    ];
    world.paths.pow.set(srv.userData.id, { pts: ppts, pduIdx: 5, upsId: ups.userData.id });
  }
}

// ---------- 区域标签 ----------
function buildZoneLabels(world) {
  const add = (text, x, y, z, cls = 'zone-label') => {
    const l = label(text, cls, x, y, z);
    world.group.add(l);
    world.zoneLabels.push(l);
  };
  const xm = (world.tileRegion.xmin + world.tileRegion.xmax) / 2;
  add('❄ 冷通道（封闭）', xm, RACK.h + 0.6, 0);
  add('🔥 热通道 A', xm, 1.4, ROWS[0].z - 1.3);
  add('🔥 热通道 B', xm, 1.4, ROWS[1].z + 1.3);
  add('核心网络区', CORE_RACK.x, 2.9, 0);
  add('供配电区', UPS_X + 0.2, 2.9, 0.2);
  add('网络桥架', -3.5, LEVELS.tray + 0.25, world.trayZ.A);
  add('母线槽', -6.5, LEVELS.busway + 0.25, world.busZ.B);
}

export { EQUIP };
