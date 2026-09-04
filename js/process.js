// ============================================================
//  运行过程演示：分步骤讲解 + 联动高亮/相机/粒子
// ============================================================
import { fmt } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Process {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.auto = false;
    this.busy = false;
    this.idx = -1;
    this.steps = [];
    this.timer = null;
    this.token = 0;
    this.cleanup = null;
  }

  start(key) {
    if (this.running) this.stop();
    const build = SCENARIOS[key];
    if (!build) return;
    const { steps, cleanup, name } = build(this.app);
    this.steps = steps; this.cleanup = cleanup;
    this.running = true; this.auto = false; this.idx = -1;
    this.app.select(null);
    this.app.flows.ambient = false;
    this.app.ui.setProcessState({ running: true, auto: false });
    this.app.log(`开始演示：${name}`, 'info');
    this.next();
  }

  async next() {
    if (!this.running || this.busy) return;
    clearTimeout(this.timer);
    this.idx++;
    if (this.idx >= this.steps.length) { this.stop(); return; }
    const step = this.steps[this.idx];
    const token = ++this.token;
    this.app.clearHl();
    this.app.ui.narrate(this.idx + 1, this.steps.length, step.title, step.text);
    this.app.log(`步骤 ${this.idx + 1}：${step.title}`);
    this.busy = true;
    try { await step.run(); } catch (e) { console.error(e); }
    this.busy = false;
    if (this.auto && this.running && token === this.token) this.timer = setTimeout(() => this.next(), step.hold ?? 2500);
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.app.ui.setProcessState({ running: this.running, auto: this.auto });
    if (this.auto && !this.busy) this.timer = setTimeout(() => this.next(), 800);
    if (!this.auto) clearTimeout(this.timer);
  }

  stop() {
    clearTimeout(this.timer);
    this.token++;
    const was = this.running;
    this.running = false; this.auto = false; this.busy = false;
    this.app.clearHl();
    this.cleanup?.();
    this.cleanup = null;
    this.app.flows.ambient = true;
    this.app.ui.setProcessState({ running: false, auto: false });
    if (was) this.app.log('演示结束', 'info');
  }
}

// ---------------------------------------------------------------
function pickServer(app, role) {
  const sel = app.selected;
  if (sel?.userData.type === 'server' && (!role || sel.userData.spec.role === role)) return sel;
  if (sel?.userData.type === 'component') return sel.userData.server;
  return app.world.byId.get('WEB-A1-01');
}

const SCENARIOS = {
  // ① 一次请求的完整旅程 ------------------------------------------
  request(app) {
    const w = app.world, f = app.flows;
    const srv = pickServer(app);
    const rack = srv.userData.rack, tor = rack.userData.tor;
    const net = w.paths.net.get(srv.userData.id);
    const router = w.byId.get('ROUTER'), fw = w.byId.get('FW'), core = w.byId.get('CORE-1');
    const storage = rack.userData.servers.find((s) => s.userData.spec.role === 'storage' && s !== srv) || w.servers.find((s) => s.userData.spec.role === 'storage');
    const stoNet = w.paths.net.get(storage.userData.id);
    const ti = net.torIdx;
    const coreToTor = net.pts.slice(0, ti + 1);
    const torToSrv = net.pts.slice(ti);
    const intra = [...net.pts.slice(ti).reverse(), ...stoNet.pts.slice(ti + 1)];
    const pow = w.paths.pow.get(srv.userData.id);
    const zT = w.trayZ[rack.userData.row];
    const steps = [
      { title: '用户请求到达出口路由器', text: `用户在互联网上发起访问，报文经运营商线路到达机房<b>出口路由器</b>。路由器执行 NAT 与 BGP 路由，把公网地址映射到内网目标 <b>${srv.userData.spec.ip}</b>。`,
        run: async () => { app.hl(router, 0xf59e0b); await app.flyView('core'); await f.burst(w.paths.core.internet, { color: 0x38bdf8, speed: 2.5 }, 4); } },
      { title: '防火墙安全检查', text: '报文进入<b>防火墙</b>：按 ACL 与状态检测表匹配五元组，执行 IPS 特征检测；合法流量放行，非法流量被丢弃并记录日志。',
        run: async () => { app.hl(fw, 0xef4444); await f.burst(w.paths.core.routerToFw, { color: 0x38bdf8, speed: 1.2 }, 4); } },
      { title: '核心交换机三层转发', text: '<b>核心交换机</b>（双机堆叠）查找路由表/FIB，确定目标所在 VLAN 与出接口，把报文送往对应机柜的上联光口。',
        run: async () => { app.hl(core, 0x38bdf8); await f.burst(w.paths.core.fwToCore, { color: 0x38bdf8, speed: 1.2 }, 4); } },
      { title: '经桥架光纤上联到 ToR 交换机', text: `100G 光纤沿<b>架空桥架</b>敷设到机柜 <b>${rack.userData.id}</b> 顶部的 <b>ToR 交换机</b>。ToR（Top-of-Rack）架构让每个机柜只需少量光纤上联，机柜内部用短铜缆下联。`,
        run: async () => { app.hl(w.tray, 0x94a3b8, 0.1); app.hl(tor, 0x38bdf8); app.flyTo([rack.userData.x + 3.5, 4.6, zT + (rack.userData.facing === 1 ? -2.5 : 2.5)], [rack.userData.x, 3.0, zT]); await f.burst(coreToTor, { color: 0x38bdf8, speed: 4 }, 5); } },
      { title: 'ToR 交付服务器网卡', text: `ToR 根据 MAC/ARP 表把报文从对应端口发往服务器 <b>${srv.userData.id}</b> 的<b>网卡 (NIC)</b>。网卡通过 DMA 把数据写入内存并触发中断。现在把这台服务器<b>抽出机柜</b>查看内部。`,
        run: async () => { app.hl(srv, 0x38bdf8); app.focusServer(srv, 1.0); await f.burst(torToSrv, { color: 0x38bdf8, speed: 1.6 }, 4); app.pullServer(srv, true); await wait(1200); } },
      { title: '网卡 → CPU → 内存：处理请求', text: '拆解视图：报文由<b>网卡</b>进入 PCIe 总线 → <b>CPU</b> 内核解析协议并执行业务逻辑 → 频繁读写<b>内存 DIMM</b>。CPU 发热由散热片与风扇带走。',
        run: async () => { app.explodeServer(srv, true); app.focusServer(srv, 1.4, true); await wait(1500); app.hlPart(srv, 'nic', 0x38bdf8); await wait(900); app.hlPart(srv, 'cpu', 0xf59e0b); await wait(900); app.hlPart(srv, 'dimm', 0xa78bfa); }, hold: 3500 },
      { title: '读写数据：本地磁盘与存储节点', text: `需要持久化数据时，CPU 通过 <b>RAID 卡</b>读写前置<b>硬盘</b>；更多数据则经 ToR 访问同柜的存储节点 <b>${storage.userData.id}</b>（分布式存储副本）。`,
        run: async () => { app.hlPart(srv, 'raid', 0x22d3ee); app.hlPart(srv, 'disk', 0x22d3ee); app.hl(storage, 0x22d3ee); await f.burst(intra, { color: 0x22d3ee, speed: 2.5 }, 5); await f.burst(intra, { color: 0x22d3ee, speed: 2.5, reverse: true }, 5); } },
      { title: '响应原路返回用户', text: '处理完成，响应报文沿 <b>NIC → ToR → 核心 → 防火墙 → 路由器 → 互联网</b> 原路返回。整个过程通常只需几毫秒。',
        run: async () => { app.explodeServer(srv, false); app.hl(srv, 0xa78bfa); await wait(800); app.flyView('overview', 1.6); await f.burst(net.pts, { color: 0xa78bfa, speed: 6, reverse: true }, 5, 0.08); f.burst(w.paths.core.fwToCore, { color: 0xa78bfa, speed: 2, reverse: true }, 3); await f.burst(w.paths.core.routerToFw, { color: 0xa78bfa, speed: 2, reverse: true }, 3); await f.burst(w.paths.core.internet, { color: 0xa78bfa, speed: 3, reverse: true }, 3); } },
      { title: '同时发生的物理过程：供电与散热', text: `处理请求消耗的电能来自 <b>UPS → 母线槽 → PDU → 双电源</b>（当前约 ${Math.round(srv.userData.state.power)} W），并几乎全部转化为热量：风扇把冷通道的冷空气吸入，带走热量后排入热通道，由精密空调回收降温。`,
        run: async () => { app.focusServer(srv, 1.2); app.hlPart(srv, 'psu', 0xf59e0b); app.hlPart(srv, 'fan', 0x38bdf8); app.hl(w.busway, 0xf59e0b, 0.25); await f.burst(pow.pts, { color: 0xf59e0b, speed: 4, layer: 'pow' }, 6); }, hold: 3500 },
      { title: '总结', text: '一次请求 = <b>数据流</b>（互联网→路由→防火墙→核心→ToR→网卡→CPU/内存/磁盘）+ <b>电力流</b>（市电→UPS→母线→PDU→PSU）+ <b>热量流</b>（冷通道→服务器→热通道→空调）。数字孪生把这三条链路实时映射到同一个模型中。',
        run: async () => { app.pullServer(srv, false); await app.flyView('overview'); } },
    ];
    return { name: '一次请求的完整旅程', steps, cleanup: () => { app.pullServer(srv, false); } };
  },

  // ② 供电链路 ------------------------------------------------------
  power(app) {
    const w = app.world, f = app.flows, sim = app.sim;
    const srv = pickServer(app);
    const rack = srv.userData.rack;
    const pow = w.paths.pow.get(srv.userData.id);
    const ups = w.byId.get(pow.upsId);
    const pdc = w.byId.get('PDC');
    const toBus = pow.pts.slice(0, 4), toPdu = pow.pts.slice(3, 6), toPsu = pow.pts.slice(5);
    const steps = [
      { title: '市电引入：低压配电柜', text: '两路 10kV 市电经变压器降至 380V 进入<b>低压配电柜</b>，ATS 自动切换开关在市电失效时切换到柴油发电机。断路器把电力分配给 UPS 与空调等负载。',
        run: async () => { app.hl(pdc, 0xf59e0b); await app.flyView('power'); } },
      { title: 'UPS：在线双变换', text: '<b>UPS</b> 先把交流整流为直流（同时给电池充电），再由逆变器输出纯净正弦波。这样负载永远由逆变器供电，市电闪断、谐波与电压波动都被隔离。A 路 / B 路两台 UPS 组成 <b>2N 冗余</b>。',
        run: async () => { app.hl(ups, 0xf59e0b); app.hl(w.byId.get(pow.upsId === 'UPS-1' ? 'UPS-2' : 'UPS-1'), 0xf59e0b, 0.2); app.select(ups); } },
      { title: '电池柜：后备能量', text: '<b>电池柜</b>为 UPS 提供后备能量，按满载 15 分钟配置，足够柴油发电机启动并接管。锂电池由 BMS 监控每个电芯的电压与温度。',
        run: async () => { app.hl(w.byId.get('BAT-1'), 0x22c55e); app.hl(w.byId.get('BAT-2'), 0x22c55e); app.flyTo([-6.5, 2.2, 2.5], [-9.6, 1.0, 1.0]); } },
      { title: '架空母线槽输送', text: '电力经<b>架空母线槽</b>沿机柜排输送。母线槽是密集型铜排，每个机柜上方安装一个<b>插接箱</b>取电，扩容时无需重新敷设电缆。母线与网络桥架分层敷设以避免电磁干扰。',
        run: async () => { app.hl(w.busway, 0xf59e0b, 0.35); app.flyTo([-2, 6, 6], [-3, 3.5, 0]); await f.burst(toBus, { color: 0xf59e0b, speed: 4, layer: 'pow' }, 8, 0.15); } },
      { title: '机柜 PDU：分配到每台设备', text: `插接箱把电送到机柜 <b>${rack.userData.id}</b> 后部两侧的<b>零 U 垂直 PDU</b>（A 路橙色、B 路蓝色）。PDU 逐路监测电流并支持远程开关插座。`,
        run: async () => { app.hl(rack.userData.pdu, 0xf59e0b); app.focusObject(rack, 3.2, true); await f.burst(toPdu, { color: 0xf59e0b, speed: 2.5, layer: 'pow' }, 6, 0.15); } },
      { title: '服务器双电源 (PSU)', text: '服务器两个<b>冗余电源</b>分别接 A/B 路 PDU，把 220V 交流转换为 12V 直流送入主板；主板 VRM 再降压到 CPU 所需的 ~1V 大电流。任一路电源或 UPS 失效都不会中断业务。',
        run: async () => { app.pullServer(srv, true); app.explodeServer(srv, true); app.focusServer(srv, 1.4, true); await wait(1400); app.hlPart(srv, 'psu', 0xf59e0b); app.hlPart(srv, 'mainboard', 0xf59e0b); await f.burst(toPsu, { color: 0xf59e0b, speed: 1.5, layer: 'pow' }, 5); }, hold: 3500 },
      { title: '模拟市电中断', text: '现在切断市电：UPS 在 <b>0 ms</b> 内切换到电池放电（在线式 UPS 无需切换，逆变器持续输出），显示屏变为黄色告警，后备时间开始倒计时；服务器毫无感知。',
        run: async () => { sim.setMains(false); app.hl(ups, 0xf59e0b); app.select(ups); await app.flyView('power'); await wait(3500); }, hold: 3000 },
      { title: '市电恢复', text: '市电恢复后 UPS 回到在线双变换模式并开始给电池充电。整个过程中 IT 负载的供电从未中断，这正是 UPS 存在的意义。',
        run: async () => { sim.setMains(true); await wait(800); } },
      { title: '总结', text: '<b>供电链路</b>：市电 → 低压配电柜 (ATS/断路器) → UPS (整流+逆变+电池) → 架空母线槽 → 插接箱 → 机柜 PDU (A/B 路) → 服务器双电源 → 主板 VRM → CPU/内存/GPU。每一级都有冗余设计。',
        run: async () => { app.pullServer(srv, false); app.select(null); await app.flyView('overview'); } },
    ];
    return { name: '供电链路', steps, cleanup: () => { sim.setMains(true); app.pullServer(srv, false); } };
  },

  // ③ 冷却循环 ------------------------------------------------------
  cooling(app) {
    const w = app.world, sim = app.sim;
    const srv = pickServer(app);
    const steps = [
      { title: '精密空调：制冷与送风', text: '<b>精密空调 (CRAC)</b> 顶部吸入热通道回风（约 30℃），经蒸发器冷却至 18℃ 并控制湿度，再由底部大风量风机压入<b>架空地板下的静压箱</b>。3 台空调 N+1 冗余，任一台停机其余两台自动提速。',
        run: async () => { for (const c of w.cracs) app.hl(c, 0x38bdf8, 0.3); await app.flyView('crac'); } },
      { title: '地板下静压箱 → 穿孔地板', text: '地板下的冷空气在静压箱中均匀分布，只从<b>冷通道的穿孔地板</b>（开孔率 25-50%）向上送出，热通道的地板不开孔，保证冷风全部送到服务器进风口。',
        run: async () => { for (const t of w.tiles) app.hl(t, 0x38bdf8, 0.5); app.flyTo([2.5, 0.9, 0.2], [-4, 0.3, 0]); } },
      { title: '冷通道封闭', text: '透明顶板与端门把<b>冷通道封闭</b>，冷热空气不再混合：送风温度可以从 15℃ 提高到 18-22℃，空调压缩机能耗大幅下降，这是降低 PUE 最有效的手段之一。',
        run: async () => { app.hl(w.containment, 0x7dd3fc, 0.4); await app.flyView('cold'); } },
      { title: '服务器风扇抽风穿过机箱', text: `服务器 <b>${srv.userData.id}</b> 的<b>风扇墙</b>把冷风从前面板吸入：先流过硬盘，再穿过 <b>CPU 散热片</b>与内存，最后经电源排出。BMC 依据各传感器温度用 PID 算法调节风扇转速。`,
        run: async () => { app.pullServer(srv, true); app.explodeServer(srv, true); app.focusServer(srv, 1.4, true); await wait(1400); app.hlPart(srv, 'fan', 0x38bdf8); app.hlPart(srv, 'cpu', 0xf97316); app.hlPart(srv, 'disk', 0x38bdf8); }, hold: 3500 },
      { title: '热通道排风', text: '穿过机箱的空气升温 10-15℃ 后从机柜后门排入<b>热通道</b>。热空气密度低自然上升，沿吊顶回风路径流向空调顶部回风口。热通道温度可达 35℃ 以上，属正常现象。',
        run: async () => { app.explodeServer(srv, false); app.pullServer(srv, false); await app.flyView('hot'); } },
      { title: '吊顶回风，闭环完成', text: '热风在吊顶汇聚，被空调<b>顶部回风口</b>吸入，冷却后再次送入地板下，形成<b>冷通道 → 服务器 → 热通道 → 空调</b>的闭环。冷/热粒子的颜色变化就是空气吸热与放热的过程。',
        run: async () => { for (const c of w.cracs) app.hl(c, 0xf97316, 0.3); app.flyTo([9, 6.5, -9], [-1, 2.5, -2]); } },
      { title: 'PUE 与能效', text: () => `当前 IT 负载 <b>${fmt(sim.totals.it / 1000, 1)} kW</b>，制冷 <b>${fmt(sim.totals.cooling / 1000, 1)} kW</b>，配电损耗 <b>${fmt(sim.totals.loss / 1000, 1)} kW</b>，PUE = 总功耗 / IT 功耗 = <b>${fmt(sim.totals.pue, 2)}</b>。提高送风温度、封闭冷通道、变频风机都能把 PUE 拉近 1.0。`,
        run: async () => { await app.flyView('overview'); } },
    ];
    return { name: '冷却循环', steps: steps.map((s) => ({ ...s, get text() { return typeof s.text === 'function' ? s.text() : s.text; } })), cleanup: () => app.pullServer(srv, false) };
  },

  // ④ 故障与冗余切换 ------------------------------------------------
  failover(app) {
    const w = app.world, sim = app.sim, f = app.flows;
    const srv = pickServer(app);
    const rack = srv.userData.rack;
    const peer = rack.userData.servers.find((s) => s !== srv && s.userData.spec.role === srv.userData.spec.role) || w.servers.find((s) => s !== srv && s.userData.spec.role === srv.userData.spec.role) || w.servers.find((s) => s !== srv);
    const net = w.paths.net.get(srv.userData.id), pnet = w.paths.net.get(peer.userData.id);
    const ti = net.torIdx;
    const intra = [...net.pts.slice(ti).reverse(), ...pnet.pts.slice(ti + 1)];
    const ups1 = w.byId.get('UPS-1'), ups2 = w.byId.get('UPS-2');
    const steps = [
      { title: '故障注入：服务器过热', text: `向 <b>${srv.userData.id}</b> 注入散热故障（如风扇失效/散热片积尘）。进风温度不变，但出风与 CPU 温度快速攀升，前面板状态灯变红闪烁。`,
        run: async () => { sim.injectFault(srv); app.hl(srv, 0xef4444); app.focusServer(srv, 1.2); app.select(srv); await wait(1500); } },
      { title: 'BMC 告警与风扇提速', text: '服务器 <b>BMC</b>（基板管理控制器）读到温度越限，通过带外管理网络发出 SNMP/Redfish 告警，同时把其余风扇拉到最高转速。数字孪生面板同步弹出告警并计入 KPI。',
        run: async () => { app.pullServer(srv, true); app.explodeServer(srv, true); app.focusServer(srv, 1.4, true); await wait(1400); app.hlPart(srv, 'fan', 0xef4444); app.hlPart(srv, 'cpu', 0xef4444); app.hl(w.byId.get('OOB'), 0xf59e0b); }, hold: 3500 },
      { title: '空调联动升频', text: '楼宇自控系统 (BMS) 收到热点告警后，把附近<b>精密空调风机</b>提速，加大冷通道送风量以压制局部热点。气流粒子明显加速。',
        run: async () => { app.explodeServer(srv, false); app.pullServer(srv, false); for (const c of w.cracs) { c.userData.state.fan = 100; app.hl(c, 0x38bdf8, 0.35); } f.air.cracFan = 1.0; await app.flyView('crac'); } },
      { title: '业务迁移到冗余节点', text: `编排系统把 <b>${srv.userData.id}</b> 上的业务迁移到同角色的 <b>${peer.userData.id}</b>：故障机负载下降、对端负载上升，用户完全无感。`,
        run: async () => { sim.migrate(srv, peer); app.hl(srv, 0xef4444); app.hl(peer, 0x22c55e); app.focusObject(rack, 3.5); await f.burst(intra, { color: 0xa78bfa, speed: 2.5 }, 8, 0.12); } },
      { title: '供电冗余验证：UPS-1 维护', text: '同时验证供电冗余：把 <b>UPS-1 (A 路)</b> 转入维护旁路。所有服务器的 B 路电源由 UPS-2 独立承担全部负载，机柜 PDU 电流显示 B 路翻倍。',
        run: async () => { app.hl(ups1, 0xef4444); app.hl(ups2, 0x22c55e); app.select(ups2); await app.flyView('power'); } },
      { title: '修复并恢复', text: '运维人员更换风扇模块（热插拔，无需停机）后温度回落，告警清除，负载回迁，空调回到经济转速。',
        run: async () => { sim.repair(srv); sim.migrations.clear(); f.air.cracFan = 0.65; app.hl(srv, 0x22c55e); app.select(srv); app.focusServer(srv, 1.2); await wait(1500); } },
      { title: '总结', text: '故障处置闭环：<b>传感器感知 → BMC 告警 → 空调联动 → 业务迁移 → 供电冗余保障 → 热插拔修复</b>。数字孪生的价值在于把这些跨系统的联动在同一模型中可视化、可推演。',
        run: async () => { app.select(null); await app.flyView('overview'); } },
    ];
    return { name: '故障告警与冗余切换', steps, cleanup: () => { sim.repair(srv); sim.migrations.clear(); f.air.cracFan = 0.65; app.pullServer(srv, false); } };
  },
};
