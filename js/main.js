// ============================================================
//  入口：组装场景、机房、仿真、交互、UI、演示流程
// ============================================================
import * as THREE from 'three';
import { createScene, VIEWS } from './scene.js';
import { buildRoom } from './room.js';
import { Flows } from './flows.js';
import { Simulation } from './simulation.js';
import { UI } from './ui.js';
import { Interaction } from './interaction.js';
import { Process } from './process.js';
import { updateServer, setPulled, setExploded, serverFrontWorld } from './server.js';
import { ROLES } from './config.js';
import { highlight, unhighlight, tempColor } from './util.js';

const loading = document.getElementById('loading');
window.addEventListener('error', (e) => {
  loading.classList.add('error');
  loading.classList.remove('done');
  loading.innerHTML = `<div>加载失败：${e.message}</div><div style="font-size:12px;margin-top:8px">请检查网络（需要访问 cdn.jsdelivr.net 加载 three.js）并用本地 HTTP 服务打开本页面</div>`;
});

const canvas = document.getElementById('scene');
const S = createScene(canvas, document.getElementById('labels'));
const world = buildRoom(S.scene);

const app = {
  canvas, camera: S.camera, scene: S.scene, world,
  selected: null, hls: new Set(), heatmap: false,
  roleName: (r) => ROLES[r].name,
  log: (msg, cls) => app.ui.log(msg, cls),
  flyView: (name, dur) => S.flyView(name, dur),
  flyTo: (p, t, dur) => S.flyTo(p, t, dur),
};
app.flows = new Flows(S.scene, world);
app.sim = new Simulation(world);
app.ui = new UI(app);
app.process = new Process(app);
app.interaction = new Interaction(app);

// ---------- 选择 ----------
app.select = (obj) => {
  if (app.selected && app.selected !== obj) { if (!app.hls.has(app.selected)) unhighlight(app.selected); }
  const again = obj && obj === app.selected;
  app.selected = obj;
  if (obj) {
    if (!app.hls.has(obj)) highlight(obj, 0x38bdf8, 0.6);
    const ud = obj.userData;
    if (ud.type === 'server') {
      if (again) app.pullServer(obj, !ud.pullTarget);
      else app.focusServer(obj, ud.pullTarget ? 1.4 : 1.6);
    } else if (ud.type === 'component') {
      // 已拆解：聚焦部件
    } else if (!again && (ud.type === 'rack' || ud.type === 'netdev' || ud.type === 'equip')) {
      if (ud.kind !== 'tile' && ud.kind !== 'containment' && ud.kind !== 'tray' && ud.kind !== 'busway') app.focusObject(obj);
    }
  }
  app.ui.show(obj);
};

app.action = (act, obj, arg) => {
  const ud = obj?.userData;
  switch (act) {
    case 'pull': app.pullServer(obj, !ud.pullTarget); app.ui.show(obj); break;
    case 'explode': app.explodeServer(obj, !ud.explodeTarget); app.ui.show(obj); app.focusServer(obj, 1.4, true); break;
    case 'focus': ud.type === 'server' ? app.focusServer(obj, ud.pullTarget ? 1.4 : 1.6) : app.focusObject(obj); break;
    case 'fault': app.sim.injectFault(obj); app.ui.show(obj); break;
    case 'repair': app.sim.repair(obj); app.ui.show(obj); break;
    case 'part': app.focusComponent(obj, arg); break;
    case 'focusPart': app.focusObject(obj, 0.6); break;
    case 'demo': app.process.start(arg); break;
    case 'pingRack': {
      const rack = world.byId.get(ud.rack);
      for (const s of rack.userData.servers) app.flows.burst(world.paths.net.get(s.userData.id).pts, { color: 0x38bdf8, speed: 5 }, 3, 0.2);
      break;
    }
    case 'mains': app.sim.setMains(!app.sim.mainsOn); break;
    case 'cracToggle': app.sim.setCrac(obj, !ud.state.on); app.ui.show(obj); break;
  }
};

// ---------- 服务器操作 ----------
app.pullServer = (g, on) => {
  if (g.userData.pullTarget === (on ? 1 : 0) && !(on && g.userData.built === false)) { setPulled(g, on); return; }
  setPulled(g, on);
  app.log(`${on ? '抽出' : '推回'}服务器 ${g.userData.id}`);
  if (app.selected === g) app.ui.show(g);
};
app.explodeServer = (g, on) => {
  setExploded(g, on);
  if (on) app.log(`拆解 ${g.userData.id}：显示内部结构`);
  if (app.selected === g) app.ui.show(g);
};
app.pushAll = () => {
  for (const s of world.servers) if (s.userData.pullTarget) setPulled(s, false);
  app.log('已推回全部服务器');
};
app.focusServer = (g, dist = 1.6, high = false) => {
  const { center, dir } = serverFrontWorld(g);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up);
  if (high) dist = Math.max(dist, 2.1);
  const pos = center.clone().addScaledVector(dir, dist).addScaledVector(up, high ? dist * 0.6 : 0.45).addScaledVector(right, dist * 0.45);
  const tgt = center.clone().addScaledVector(dir, g.userData.pullTarget ? 0.3 : 0).addScaledVector(up, high ? 0.12 : 0);
  return S.flyTo(pos, tgt, 1.2);
};
app.focusObject = (obj, dist, rear = false) => {
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const d = dist ?? size * 1.1 + 0.8;
  let dir;
  const facingObj = obj.userData.type === 'rack' || obj.userData.type === 'equip' && (obj.userData.kind === 'crac' || obj.userData.kind === 'ups' || obj.userData.kind === 'battery' || obj.userData.kind === 'pdc') ? obj
    : obj.userData.type === 'netdev' ? obj.parent : null;
  if (facingObj) {
    dir = facingObj.localToWorld(new THREE.Vector3(0, 0, rear ? -1 : 1)).sub(facingObj.localToWorld(new THREE.Vector3(0, 0, 0))).normalize();
  } else {
    dir = S.camera.position.clone().sub(c); dir.y = 0; dir.normalize();
  }
  const pos = c.clone().addScaledVector(dir, d).add(new THREE.Vector3(dir.z * d * 0.3, d * 0.45, -dir.x * d * 0.3));
  return S.flyTo(pos, c, 1.2);
};
app.focusComponent = (srv, key) => {
  if (!srv.userData.explodeTarget) { app.explodeServer(srv, true); }
  const p = srv.userData.parts.find((x) => x.key === key);
  if (!p) return;
  app.clearHl();
  app.hlPart(srv, key, 0xf59e0b);
  app.select(p.obj);
  document.querySelectorAll('.parts li').forEach((li) => li.classList.toggle('active', li.dataset.arg === key));
  setTimeout(() => app.focusObject(p.obj, 0.7), 300);
};

// ---------- 高亮集合（演示用） ----------
app.hl = (obj, color = 0x38bdf8, intensity = 0.6) => {
  if (!obj) return;
  unhighlight(obj);
  highlight(obj, color, intensity);
  app.hls.add(obj);
};
app.hlPart = (srv, key, color = 0xf59e0b) => {
  const p = srv.userData.parts?.find((x) => x.key === key);
  if (p) app.hl(p.obj, color, 0.8);
};
app.clearHl = () => {
  for (const o of app.hls) unhighlight(o);
  app.hls.clear();
  if (app.selected) highlight(app.selected, 0x38bdf8, 0.6);
};

// ---------- 图层 ----------
app.setLayer = (name, on) => app.flows.setLayer(name, on);
app.setLabels = (on) => { for (const l of [...world.zoneLabels, ...world.rackLabels]) l.visible = on; };
const heatOrig = new Map();
app.setHeatmap = (on) => {
  app.heatmap = on;
  for (const s of world.servers) {
    const plate = s.userData.plate;
    if (on) {
      if (!heatOrig.has(plate)) heatOrig.set(plate, plate.material);
      const m = heatOrig.get(plate).clone();
      m.emissiveIntensity = 0.9;
      if (plate.userData._orig) plate.userData._orig = m; else plate.material = m;
    } else if (heatOrig.has(plate)) {
      const orig = heatOrig.get(plate);
      if (plate.userData._orig) plate.userData._orig = orig; else plate.material = orig;
      heatOrig.delete(plate);
    }
  }
};
function applyHeatmap() {
  for (const s of world.servers) {
    const plate = s.userData.plate;
    const m = plate.userData._orig || plate.material;
    if (!heatOrig.has(plate)) continue;
    const c = tempColor(s.userData.state.temp);
    m.color.copy(c); m.emissive.copy(c);
  }
}

// ---------- 仿真事件 → 日志 ----------
app.sim.on((e) => {
  if (e.type === 'fault') app.log(`🔴 故障：${e.server.userData.id} 散热异常，温度快速上升`, 'err');
  else if (e.type === 'repair') app.log(`🟢 已修复：${e.server.userData.id}`, 'ok');
  else if (e.type === 'status' && e.status === 'warning') app.log(`🟡 预警：${e.server.userData.id} 温度 ${e.server.userData.state.temp.toFixed(1)}℃ 越限`, 'warn');
  else if (e.type === 'status' && e.status === 'normal') app.log(`${e.server.userData.id} 恢复正常`, 'ok');
  else if (e.type === 'mains') app.log(e.on ? '🟢 市电恢复，UPS 回到在线模式' : '🔴 市电中断！UPS 切换电池供电', e.on ? 'ok' : 'err');
  else if (e.type === 'crac') app.log(`${e.crac.userData.id} ${e.on ? '开机' : '停机，其余空调提速补偿'}`, e.on ? 'ok' : 'warn');
  else if (e.type === 'migrate') app.log(`业务迁移：${e.from.userData.id} → ${e.to.userData.id}`, 'info');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { app.select(null); app.pushAll(); }
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let uiTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  step(Math.min(0.05, clock.getDelta()));
}
function step(dt) {
  app.sim.tick(dt);
  for (const s of world.servers) updateServer(s, dt);
  let fanSum = 0;
  for (const c of world.cracs) {
    const st = c.userData.state;
    fanSum += st.fan;
    const spin = st.fan * 0.12 * dt;
    for (const r of c.userData.fans) r.rotation.z -= spin;
    const col = st.on ? 0x38bdf8 : 0xef4444;
    if (c.userData.screen.color.getHex() !== col) { c.userData.screen.color.setHex(col); c.userData.screen.emissive.setHex(col); }
  }
  if (!app.process.running) app.flows.air.cracFan = fanSum / world.cracs.length / 100;
  app.flows.update(dt);
  app.interaction.update();
  S.update(dt);
  uiTimer += dt;
  if (uiTimer > 0.5) {
    uiTimer = 0;
    app.ui.updateKPIs(app.sim.totals);
    app.ui.tick();
    if (app.heatmap) applyHeatmap();
  }
  S.render();
}
animate();
app.step = step;
setTimeout(() => loading.classList.add('done'), 400);
app.log('数字孪生机房已就绪：' + world.servers.length + ' 台服务器，' + world.netdevs.length + ' 台网络设备', 'ok');
window.app = app;
