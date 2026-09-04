// ============================================================
//  运行仿真：负载、温度、功耗、告警、UPS/空调状态
// ============================================================
import { ROLES } from './config.js';
import { clamp, lerp } from './util.js';

export class Simulation {
  constructor(world) {
    this.world = world;
    this.time = 0;
    this.alarms = [];
    this.listeners = [];
    this.coldSupply = 18;     // 冷通道送风温度
    this.mainsOn = true;      // 市电
    this.migrations = new Map();
    this.totals = { it: 0, cooling: 0, loss: 0, total: 0, pue: 1.4, avgTemp: 25, maxTemp: 25, alarms: 0, maxServer: null };
    for (const s of world.servers) {
      const st = s.userData.state;
      st.phase = Math.random() * Math.PI * 2;
      st.target = st.load;
    }
  }

  on(fn) { this.listeners.push(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  tick(dt) {
    this.time += dt;
    const t = this.time;
    let it = 0, sumT = 0, maxT = -1, maxS = null, alarms = 0;
    const rackPower = new Map();

    for (const s of this.world.servers) {
      const ud = s.userData, st = ud.state, role = ROLES[ud.spec.role];
      // 负载：基线 + 慢周期 + 随机扰动 + 迁移调整
      const mig = this.migrations.get(ud.id) || 0;
      const wave = Math.sin(t * 0.08 + st.phase) * 0.5 + Math.sin(t * 0.37 + st.phase * 2) * 0.3;
      st.target = clamp(role.base + role.amp * wave + mig, 0.03, 0.99);
      if (Math.random() < 0.02) st.target = clamp(st.target + (Math.random() - 0.5) * 0.3, 0.03, 0.99);
      st.load = lerp(st.load, st.target, 1 - Math.exp(-dt * 0.8));
      // 功耗
      st.power = role.idle + (role.max - role.idle) * Math.pow(st.load, 1.3);
      // 温度：进风温度 + 负载发热 + 故障额外升温
      const heatFactor = ud.spec.role === 'ai' ? 30 : 24;
      const tTarget = this.coldSupply + 6 + st.load * heatFactor + (st.fault ? 28 : 0) + (st.fanFail ? 12 : 0);
      st.temp = lerp(st.temp, tTarget, 1 - Math.exp(-dt * 0.25));
      // 状态
      const prev = st.status;
      st.status = st.fault ? 'fault' : st.temp > 62 ? 'warning' : 'normal';
      if (st.status !== prev) this.emit({ type: 'status', server: s, status: st.status });
      if (st.status !== 'normal') alarms++;
      it += st.power;
      sumT += st.temp;
      if (st.temp > maxT) { maxT = st.temp; maxS = s; }
      rackPower.set(ud.rack.userData.id, (rackPower.get(ud.rack.userData.id) || 0) + st.power);
    }
    // 网络设备
    for (const nd of this.world.netdevs) {
      const st = nd.userData.state;
      st.throughput = Math.max(0, st.throughput - st.throughput * dt * 0.5);
      st.cpu = clamp(lerp(st.cpu, 0.08 + st.throughput * 0.01, dt), 0.05, 0.95);
      it += nd.userData.kind === 'core' ? 800 : nd.userData.kind === 'tor' ? 180 : 250;
      nd.userData.faceMat.emissiveIntensity = 0.7 + Math.random() * 0.5;
    }
    const cooling = it * (0.30 + (this.world.cracs.filter((c) => c.userData.state.on).length < 3 ? 0.08 : 0)) + 6000;
    const loss = it * 0.07 + 1500;
    const total = it + cooling + loss;
    this.totals = { it, cooling, loss, total, pue: total / it, avgTemp: sumT / this.world.servers.length, maxTemp: maxT, maxServer: maxS, alarms, rackPower };

    // UPS
    for (const u of this.world.ups) {
      const st = u.userData.state;
      const share = it / 2 + 700;
      st.load = share;
      st.onBattery = !this.mainsOn;
      if (st.onBattery) { st.battery = Math.max(0, st.battery - dt * 0.4); st.runtime = st.battery * 0.15; u.userData.screen.color.setHex(0xf59e0b); u.userData.screen.emissive.setHex(0xf59e0b); }
      else { st.battery = Math.min(100, st.battery + dt * 0.2); st.runtime = 15; u.userData.screen.color.setHex(0x22c55e); u.userData.screen.emissive.setHex(0x22c55e); }
    }
    // 空调：回风温度随 IT 负载变化
    const onCount = this.world.cracs.filter((c) => c.userData.state.on).length || 1;
    for (const c of this.world.cracs) {
      const st = c.userData.state;
      st.supply = this.coldSupply;
      st.ret = this.coldSupply + 8 + (it / 1000) * 0.25;
      const fanTarget = st.on ? clamp(45 + (it / 1000) * 1.2 + (3 - onCount) * 15 + (alarms > 0 ? 10 : 0), 40, 100) : 0;
      st.fan = lerp(st.fan, fanTarget, dt * 0.5);
      st.power = st.on ? cooling / onCount / 1000 : 0;
    }
  }

  injectFault(server) {
    const s = server || this.world.servers[Math.floor(Math.random() * this.world.servers.length)];
    s.userData.state.fault = true;
    this.emit({ type: 'fault', server: s });
    return s;
  }
  repair(server) {
    server.userData.state.fault = false;
    server.userData.state.fanFail = false;
    this.emit({ type: 'repair', server: server });
  }
  repairAll() {
    for (const s of this.world.servers) if (s.userData.state.fault || s.userData.state.fanFail) this.repair(s);
    this.migrations.clear();
    this.mainsOn = true;
    for (const c of this.world.cracs) c.userData.state.on = true;
  }
  setMains(on) { this.mainsOn = on; this.emit({ type: 'mains', on }); }
  migrate(from, to, amount = 0.35) {
    this.migrations.set(from.userData.id, -amount);
    this.migrations.set(to.userData.id, amount);
    this.emit({ type: 'migrate', from, to });
  }
  setCrac(crac, on) { crac.userData.state.on = on; this.emit({ type: 'crac', crac, on }); }
}
