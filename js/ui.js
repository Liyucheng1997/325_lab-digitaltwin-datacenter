// ============================================================
//  DOM 面板：KPI、详情、日志、旁白、控制按钮
// ============================================================
import { ROLES, ROLE_PRINCIPLE, COMPONENTS, EQUIP, NET_KINDS, PROFILES } from './config.js';
import { fmt } from './util.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app;
    this.detail = $('detail');
    this.logEl = $('log');
    this.current = null;
    this.bind();
    this.showOverview();
  }

  bind() {
    const app = this.app;
    for (const k of ['net', 'pow', 'air']) $(`ly-${k}`).addEventListener('change', (e) => app.setLayer(k, e.target.checked));
    $('ly-heat').addEventListener('change', (e) => app.setHeatmap(e.target.checked));
    $('ly-labels').addEventListener('change', (e) => app.setLabels(e.target.checked));
    $('ly-cont').addEventListener('change', (e) => { app.world.containment.visible = e.target.checked; });
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => app.flyView(b.dataset.view)));
    $('p-start').addEventListener('click', () => app.process.start($('scenario').value));
    $('p-next').addEventListener('click', () => app.process.next());
    $('p-auto').addEventListener('click', () => app.process.toggleAuto());
    $('p-stop').addEventListener('click', () => app.process.stop());
    $('f-server').addEventListener('click', () => { const s = app.sim.injectFault(); app.select(s); });
    $('f-mains').addEventListener('click', () => app.sim.setMains(!app.sim.mainsOn));
    $('f-crac').addEventListener('click', () => { const c = app.world.byId.get('CRAC-1'); app.sim.setCrac(c, !c.userData.state.on); });
    $('f-repair').addEventListener('click', () => app.sim.repairAll());
    $('a-pushall').addEventListener('click', () => app.pushAll());
    $('a-traffic').addEventListener('click', (e) => { const s = app.flows.trafficScale = app.flows.trafficScale >= 4 ? 1 : app.flows.trafficScale * 2; e.target.textContent = `流量 ×${s}`; });
  }

  setProcessState({ running, auto }) {
    $('p-start').disabled = running;
    $('p-next').disabled = !running || auto;
    $('p-auto').disabled = !running;
    $('p-stop').disabled = !running;
    $('p-auto').classList.toggle('active', !!auto);
    $('p-auto').textContent = auto ? '暂停自动' : '自动播放';
    $('narration').classList.toggle('hidden', !running);
  }
  narrate(idx, total, title, text) {
    $('n-step').textContent = `${idx}/${total}`;
    $('n-title').textContent = title;
    $('n-text').innerHTML = text;
  }

  log(msg, cls = '') {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    d.innerHTML = `<span class="t">${t}</span>${msg}`;
    this.logEl.prepend(d);
    while (this.logEl.children.length > 60) this.logEl.lastChild.remove();
  }

  updateKPIs(T) {
    $('kpi-it').textContent = fmt(T.it / 1000, 1);
    $('kpi-total').textContent = fmt(T.total / 1000, 1);
    $('kpi-pue').textContent = fmt(T.pue, 2);
    $('kpi-avg').textContent = fmt(T.avgTemp, 1);
    $('kpi-max').textContent = fmt(T.maxTemp, 1);
    $('kpi-alarm').textContent = T.alarms;
    $('kpi-alarm').parentElement.classList.toggle('active', T.alarms > 0);
    $('kpi-clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    $('f-mains').textContent = this.app.sim.mainsOn ? '市电中断' : '恢复市电';
    const c1 = this.app.world.byId.get('CRAC-1');
    $('f-crac').textContent = c1.userData.state.on ? 'CRAC-1 停机' : 'CRAC-1 开机';
  }

  // ---------- 详情 ----------
  meter(label, field, unit = '%', cls = '') {
    return `<div class="meter"><div class="row"><span>${label}</span><b><span data-f="${field}">--</span>${unit}</b></div><div class="bar"><i data-b="${field}" class="${cls}" style="width:0%"></i></div></div>`;
  }

  show(obj) {
    this.current = obj;
    if (!obj) { this.showOverview(); return; }
    const ud = obj.userData;
    const fn = { server: this.renderServer, component: this.renderComponent, rack: this.renderRack, netdev: this.renderNetdev, equip: this.renderEquip }[ud.type];
    this.detail.innerHTML = fn ? fn.call(this, obj) : `<h2>${ud.name || ud.id}</h2>`;
    this.detail.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.app.action(b.dataset.act, obj, b.dataset.arg)));
    this.detail.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => this.app.select(this.app.world.byId.get(b.dataset.sel))));
    this.tick();
  }

  showOverview() {
    const w = this.app.world;
    this.detail.innerHTML = `
      <h2>机房概况 <span class="tag">DIGITAL TWIN</span></h2>
      <div class="sub">点击任意设备查看其结构、原理与实时状态</div>
      <table>
        <tr><td>机柜</td><td>${w.racks.length - 1} 个业务机柜 + 1 个核心网络机柜</td></tr>
        <tr><td>服务器</td><td>${w.servers.length} 台</td></tr>
        <tr><td>网络设备</td><td>${w.netdevs.length} 台</td></tr>
        <tr><td>供电</td><td>2N：UPS-1 (A 路) / UPS-2 (B 路)</td></tr>
        <tr><td>制冷</td><td>N+1：3 台精密空调，冷通道封闭</td></tr>
        <tr><td>IT 负载</td><td><span data-f="it">--</span> kW</td></tr>
        <tr><td>PUE</td><td><span data-f="pue">--</span></td></tr>
      </table>
      <div class="desc"><b>机房布局原理</b><br>两排机柜<b>面对面</b>摆放，中间形成<b>冷通道</b>：精密空调把冷风压入架空地板下，经穿孔地板送入封闭冷通道；服务器风扇把冷风从前面板吸入，流经 CPU/内存/GPU 后从尾部排入<b>热通道</b>；热风上升到吊顶回到空调顶部回风口，完成循环。</div>
      <div class="desc"><b>数据流</b>：互联网 → 出口路由器 → 防火墙 → 核心交换机 → 桥架光纤 → 机柜顶 ToR 交换机 → 服务器网卡。<br><b>电力流</b>：市电 → 低压配电柜 → UPS(+电池) → 架空母线槽 → 机柜 PDU → 服务器双电源。</div>
      <div class="actions"><button data-act="demo" data-arg="request" class="primary">▶ 播放一次请求的旅程</button></div>`;
    this.detail.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.app.action(b.dataset.act, null, b.dataset.arg)));
    this.current = null;
  }

  renderServer(g) {
    const ud = g.userData, s = ud.spec, role = ROLES[s.role];
    const partsList = ud.built ? ud.parts : null;
    const keys = partsList ? partsList.map((p) => p.key) : (s.role === 'jbod' ? ['lid', 'disk', 'fan', 'backplane', 'sas', 'psu'] : s.role === 'ai' ? ['lid', 'disk', 'fan', 'mainboard', 'cpu', 'dimm', 'gpu', 'psu'] : ['lid', 'disk', 'fan', 'backplane', 'mainboard', 'cpu', 'dimm', 'nic', 'raid', 'psu']);
    const names = partsList ? Object.fromEntries(partsList.map((p) => [p.key, p.obj.userData.name])) : {};
    return `
      <h2>${ud.id} <span class="tag" data-f="statusTag">正常</span></h2>
      <div class="sub">${role.name} · 机柜 ${s.rack} · U${s.u}-${s.u + s.units - 1} (${s.units}U) · IP ${s.ip} · ${s.sn}</div>
      ${this.meter('CPU / GPU 负载', 'load')}
      ${this.meter('进风→出风温度', 'temp', '℃')}
      ${this.meter('功耗', 'power', ' W', 'pow')}
      <div class="actions">
        <button data-act="pull" class="primary">${ud.pullTarget ? '推回机柜' : '抽出服务器'}</button>
        <button data-act="explode">${ud.explodeTarget ? '合并部件' : '拆解视图'}</button>
        <button data-act="focus">聚焦</button>
        <button data-act="${ud.state.fault ? 'repair' : 'fault'}" class="${ud.state.fault ? 'ok' : 'danger'}">${ud.state.fault ? '修复' : '注入故障'}</button>
        <button data-sel="${s.rack}">所在机柜</button>
      </div>
      <div class="desc"><b>工作原理</b><br>${ROLE_PRINCIPLE[s.role]}</div>
      <h3>内部结构（点击定位部件）</h3>
      <ul class="parts">${keys.map((k) => `<li data-act="part" data-arg="${k}"><span>${names[k] || COMPONENTS[k].name}</span><span class="st" data-f="p_${k}"></span></li>`).join('')}</ul>
      <div class="desc"><b>气流路径</b>：冷通道 → 前面板硬盘 → 风扇墙 → CPU 散热片 / 内存 ${s.role === 'ai' ? '/ GPU' : ''} → 电源 → 热通道。<br><b>电力路径</b>：PDU A/B → 双电源 → 主板 12V → VRM → CPU/内存。</div>`;
  }

  renderComponent(obj) {
    const ud = obj.userData, c = COMPONENTS[ud.key] || { name: ud.name, desc: '' };
    const srv = ud.server;
    return `
      <h2>${ud.name} <span class="tag">部件</span></h2>
      <div class="sub">所属：${srv.userData.id}（${ROLES[srv.userData.spec.role].name}）</div>
      <div class="desc">${c.desc}</div>
      ${this.componentMetrics(ud.key)}
      <div class="actions"><button data-sel="${srv.userData.id}" class="primary">← 返回整机</button><button data-act="focusPart">聚焦部件</button></div>`;
  }
  componentMetrics(key) {
    const m = {
      cpu: this.meter('核心利用率', 'load') + this.meter('结温', 'cpuTemp', '℃'),
      gpu: this.meter('GPU 利用率', 'load') + this.meter('GPU 温度', 'gpuTemp', '℃') + this.meter('显存占用', 'vram'),
      dimm: this.meter('内存占用', 'mem'),
      fan: this.meter('风扇转速', 'rpm', ' RPM'),
      psu: this.meter('输出功率', 'power', ' W', 'pow') + this.meter('转换效率', 'eff'),
      disk: this.meter('磁盘 IO 利用率', 'io'),
      nic: this.meter('网络吞吐', 'net', ' Gbps'),
    };
    return m[key] || '';
  }

  renderRack(g) {
    const ud = g.userData;
    const isCore = ud.id === 'CORE';
    const list = isCore
      ? ud.netdevs.map((n) => `<li data-sel="${n.userData.id}"><span>${n.userData.name}</span><span></span><span class="t">${NET_KINDS[n.userData.kind].ports} 口</span></li>`).join('')
      : ud.servers.map((s) => `<li data-sel="${s.userData.id}" data-srv="${s.userData.id}"><span>${s.userData.id}</span><span class="mini">U${s.userData.spec.u}</span><span class="t">--</span></li>`).join('');
    return `
      <h2>${ud.name} <span class="tag">${PROFILES[ud.profile].name}</span></h2>
      <div class="sub">${isCore ? '面向机柜排，汇聚全部 ToR 上联' : `第 ${ud.row} 排 · 前门朝向冷通道 · ${ud.servers.length} 台设备`}</div>
      ${isCore ? '' : this.meter('机柜功耗', 'rackPower', ' kW', 'pow') + this.meter('机柜平均温度', 'rackTemp', '℃')}
      <div class="desc">${EQUIP.rack.desc}</div>
      <h3>${isCore ? '设备清单' : '柜内设备 (自上而下)'}</h3>
      ${isCore ? '' : `<ul class="srvlist"><li data-sel="${ud.id}-TOR"><span>${ud.tor.userData.name}</span><span class="mini">U42</span><span class="t">ToR</span></li></ul>`}
      <ul class="srvlist">${list}</ul>
      <div class="actions"><button data-act="focus" class="primary">聚焦机柜</button></div>`;
  }

  renderNetdev(g) {
    const ud = g.userData, k = NET_KINDS[ud.kind];
    const e = EQUIP[ud.kind] || {};
    const rack = ud.rack;
    return `
      <h2>${ud.name} <span class="tag">${k.name}</span></h2>
      <div class="sub">机柜 ${rack} · ${k.ports} 端口 · 双电源</div>
      ${this.meter('端口利用率', 'ports')}
      ${this.meter('交换芯片负载', 'cpu')}
      ${this.meter('实时吞吐', 'tp', ' Gbps')}
      <div class="desc">${e.desc || ''}</div>
      ${ud.kind === 'tor' ? `<div class="desc"><b>连接关系</b>：下联本机柜 ${this.app.world.byId.get(rack).userData.servers.length} 台服务器（25G DAC）；上联核心交换机 1/2（100G 光纤，经桥架）。</div>` : ''}
      <div class="actions"><button data-act="focus" class="primary">聚焦</button>${ud.kind === 'tor' ? `<button data-act="pingRack">演示：核心 → 本机柜流量</button>` : ''}<button data-sel="${rack}">所在机柜</button></div>`;
  }

  renderEquip(g) {
    const ud = g.userData, e = EQUIP[ud.kind] || { name: ud.name, desc: '' };
    let metrics = '', actions = `<button data-act="focus" class="primary">聚焦</button>`;
    if (ud.kind === 'ups') {
      metrics = this.meter('负载', 'upsLoad', ' kW', 'pow') + this.meter('电池电量', 'battery') + `<table><tr><td>运行模式</td><td data-f="upsMode">--</td></tr><tr><td>后备时间</td><td><span data-f="runtime">--</span> min</td></tr><tr><td>输入/输出</td><td>380V / 380V 50Hz</td></tr></table>`;
      actions += `<button data-act="mains" class="danger">切换市电</button><button data-act="demo" data-arg="power">演示供电链路</button>`;
    } else if (ud.kind === 'crac') {
      metrics = this.meter('风机转速', 'fan') + this.meter('制冷功耗', 'cracPower', ' kW', 'pow') + `<table><tr><td>送风温度</td><td><span data-f="supply">--</span> ℃</td></tr><tr><td>回风温度</td><td><span data-f="ret">--</span> ℃</td></tr><tr><td>状态</td><td data-f="cracState">--</td></tr></table>`;
      actions += `<button data-act="cracToggle" class="danger">开/停机</button><button data-act="demo" data-arg="cooling">演示冷却循环</button>`;
    } else if (ud.kind === 'pdu') {
      metrics = this.meter('输出电流', 'pduA', ' A', 'pow');
      actions += `<button data-sel="${ud.rack.userData.id}">所在机柜</button>`;
    } else if (ud.kind === 'busway') {
      actions += `<button data-act="demo" data-arg="power">演示供电链路</button>`;
    } else if (ud.kind === 'tile' || ud.kind === 'containment') {
      actions += `<button data-act="demo" data-arg="cooling">演示冷却循环</button>`;
    }
    return `<h2>${ud.name} <span class="tag">${e.name}</span></h2><div class="sub">${ud.id}</div>${metrics}<div class="desc">${e.desc}</div><div class="actions">${actions}</div>`;
  }

  // 每 0.5s 刷新动态数值
  tick() {
    const obj = this.current;
    const T = this.app.sim.totals;
    const set = (f, v, pct, cls) => {
      const el = this.detail.querySelector(`[data-f="${f}"]`);
      if (el) el.textContent = v;
      const b = this.detail.querySelector(`[data-b="${f}"]`);
      if (b) { b.style.width = `${Math.max(0, Math.min(100, pct))}%`; if (cls !== undefined) b.className = cls; }
    };
    if (!obj) { set('it', fmt(T.it / 1000, 1)); set('pue', fmt(T.pue, 2)); return; }
    const ud = obj.userData;
    if (ud.type === 'server' || ud.type === 'component') {
      const srv = ud.type === 'server' ? obj : ud.server;
      const st = srv.userData.state;
      const cls = st.status === 'fault' ? 'err' : st.status === 'warning' ? 'warn' : '';
      set('load', Math.round(st.load * 100), st.load * 100, cls);
      set('temp', fmt(st.temp, 1), ((st.temp - 18) / 62) * 100, cls);
      set('power', Math.round(st.power), (st.power / ROLES[srv.userData.spec.role].max) * 100, 'pow');
      const tag = this.detail.querySelector('[data-f="statusTag"]');
      if (tag) { tag.textContent = { normal: '正常', warning: '温度预警', fault: '故障' }[st.status]; tag.className = `tag ${cls || 'ok'}`; }
      set('cpuTemp', fmt(st.temp + 22 + st.load * 15, 0), (st.temp + 22 + st.load * 15) / 100 * 100, cls);
      set('gpuTemp', fmt(st.temp + 25 + st.load * 20, 0), (st.temp + 25 + st.load * 20) / 100 * 100, cls);
      set('vram', Math.round(30 + st.load * 60), 30 + st.load * 60);
      set('mem', Math.round(35 + st.load * 45), 35 + st.load * 45);
      set('rpm', Math.round(3000 + st.load * 9000 + (st.fault ? 4000 : 0)), (3000 + st.load * 9000) / 160, cls);
      set('eff', fmt(92 + st.load * 3, 1), 92 + st.load * 3);
      set('io', Math.round(st.load * 70 + 5), st.load * 70 + 5);
      set('net', fmt(st.load * 18, 1), st.load * 72);
      for (const k of ['cpu', 'fan', 'psu', 'disk', 'gpu']) {
        const el = this.detail.querySelector(`[data-f="p_${k}"]`);
        if (!el) continue;
        el.textContent = k === 'cpu' ? `${Math.round(st.load * 100)}% · ${Math.round(st.temp + 22 + st.load * 15)}℃` : k === 'fan' ? `${Math.round(3000 + st.load * 9000 + (st.fault ? 4000 : 0))} RPM` : k === 'psu' ? `${Math.round(st.power)} W` : k === 'gpu' ? `${Math.round(st.load * 100)}%` : `${Math.round(st.load * 70 + 5)}% IO`;
      }
    } else if (ud.type === 'rack') {
      const p = (T.rackPower?.get(ud.id) || 0) / 1000;
      set('rackPower', fmt(p, 2), p / 15 * 100, 'pow');
      const temps = ud.servers.map((s) => s.userData.state.temp);
      const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
      set('rackTemp', fmt(avg, 1), ((avg - 18) / 62) * 100, avg > 60 ? 'warn' : '');
      this.detail.querySelectorAll('[data-srv]').forEach((li) => {
        const s = this.app.world.byId.get(li.dataset.srv).userData.state;
        li.querySelector('.t').textContent = `${s.temp.toFixed(1)}℃ · ${Math.round(s.load * 100)}%`;
        li.className = s.status === 'fault' ? 'err' : s.status === 'warning' ? 'warn' : '';
      });
    } else if (ud.type === 'netdev') {
      const st = ud.state;
      set('ports', Math.round(st.up / st.ports * 100), st.up / st.ports * 100);
      set('cpu', Math.round(st.cpu * 100), st.cpu * 100);
      const tp = st.throughput * 2.5 + (ud.kind === 'core' ? 120 : 4) * (0.8 + Math.random() * 0.4);
      set('tp', fmt(tp, 1), tp / (ud.kind === 'core' ? 6.4 : 1.6));
    } else if (ud.type === 'equip') {
      const st = ud.state || {};
      if (ud.kind === 'ups') {
        set('upsLoad', fmt(st.load / 1000, 1), st.load / 1000 / 60 * 100, 'pow');
        set('battery', Math.round(st.battery), st.battery, st.onBattery ? 'warn' : '');
        set('upsMode', st.onBattery ? '⚠ 电池放电（市电中断）' : '在线双变换（市电正常）');
        set('runtime', fmt(st.runtime, 1));
      } else if (ud.kind === 'crac') {
        set('fan', Math.round(st.fan), st.fan, st.on ? '' : 'err');
        set('cracPower', fmt(st.power, 1), st.power / 15 * 100, 'pow');
        set('supply', fmt(st.supply, 1)); set('ret', fmt(st.ret, 1));
        set('cracState', st.on ? '运行中' : '⚠ 停机');
      } else if (ud.kind === 'pdu') {
        const p = (T.rackPower?.get(ud.rack.userData.id) || 0) / 2;
        set('pduA', fmt(p / 220, 1), p / 220 / 32 * 100, 'pow');
      }
    }
  }
}
