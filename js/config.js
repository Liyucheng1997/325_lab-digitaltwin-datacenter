// ============================================================
//  数字孪生机房 · 全局配置与数据模型
//  单位：米 (m)；坐标系：x 向右，y 向上，z 向观察者
// ============================================================

export const ROOM = { w: 22, d: 15, h: 4.2 };

// 标准 42U 机柜
export const RACK = { w: 0.6, d: 1.2, h: 2.2, units: 42, uH: 0.0445, base: 0.08 };
export const RACK_PITCH = 1.2;
export const RACKS_PER_ROW = 6;

// 两排机柜面对面，中间是冷通道 (z≈0)，背后是热通道
export const ROWS = [
  { id: 'A', z: -1.5, facing: 1, profile: ['compute', 'compute', 'compute', 'compute', 'db', 'db'] },
  { id: 'B', z: 1.5, facing: -1, profile: ['gpu', 'gpu', 'storage', 'storage', 'compute', 'compute'] },
];
export const rackX = (i) => (i - (RACKS_PER_ROW - 1) / 2) * RACK_PITCH - 1.2;

export const CORE_RACK = { id: 'CORE', x: 4.0, z: 0 };
export const UPS_X = -9.6;
export const CRACS = [
  { id: 'CRAC-1', x: -4, z: -6.9, facing: 1 },
  { id: 'CRAC-2', x: 4, z: -6.9, facing: 1 },
  { id: 'CRAC-3', x: 0, z: 6.9, facing: -1 },
];
export const LEVELS = { tray: 3.15, busway: 3.55 };
export const COLD_AISLE = { halfWidth: 0.9 };

// 机柜配置模板：u 为起始 U 位（自下向上），units 为高度
export const PROFILES = {
  compute: {
    name: '通用计算机柜',
    slots: [
      { u: 38, units: 2, role: 'web' }, { u: 36, units: 2, role: 'web' },
      { u: 34, units: 2, role: 'app' }, { u: 32, units: 2, role: 'app' },
      { u: 30, units: 2, role: 'app' }, { u: 28, units: 2, role: 'web' },
      { u: 26, units: 2, role: 'app' }, { u: 24, units: 2, role: 'web' },
      { u: 18, units: 4, role: 'storage' },
    ],
  },
  db: {
    name: '数据库机柜',
    slots: [
      { u: 38, units: 2, role: 'db' }, { u: 36, units: 2, role: 'db' },
      { u: 34, units: 2, role: 'db' }, { u: 32, units: 2, role: 'db' },
      { u: 30, units: 2, role: 'db' }, { u: 28, units: 2, role: 'db' },
      { u: 22, units: 4, role: 'storage' }, { u: 17, units: 4, role: 'storage' },
    ],
  },
  gpu: {
    name: 'GPU 训练机柜',
    slots: [
      { u: 37, units: 4, role: 'ai' }, { u: 32, units: 4, role: 'ai' },
      { u: 27, units: 4, role: 'ai' }, { u: 22, units: 4, role: 'ai' },
      { u: 18, units: 2, role: 'app' },
    ],
  },
  storage: {
    name: '分布式存储机柜',
    slots: [
      { u: 38, units: 2, role: 'storage' }, { u: 36, units: 2, role: 'storage' },
      { u: 30, units: 4, role: 'jbod' }, { u: 25, units: 4, role: 'jbod' }, { u: 20, units: 4, role: 'jbod' },
    ],
  },
  network: { name: '核心网络机柜', slots: [] },
};

// 服务器角色：功耗/负载特性
export const ROLES = {
  web:     { name: 'Web 服务器',        prefix: 'WEB',  idle: 110, max: 380,  base: 0.35, amp: 0.30, color: 0x3b82f6 },
  app:     { name: '应用服务器',        prefix: 'APP',  idle: 120, max: 420,  base: 0.45, amp: 0.25, color: 0x8b5cf6 },
  db:      { name: '数据库服务器',      prefix: 'DB',   idle: 150, max: 520,  base: 0.50, amp: 0.25, color: 0xf59e0b },
  ai:      { name: 'GPU 训练服务器',    prefix: 'GPU',  idle: 450, max: 3200, base: 0.70, amp: 0.25, color: 0x22c55e },
  storage: { name: '存储服务器',        prefix: 'STO',  idle: 220, max: 480,  base: 0.30, amp: 0.20, color: 0x06b6d4 },
  jbod:    { name: '磁盘扩展柜 (JBOD)', prefix: 'JBOD', idle: 200, max: 320,  base: 0.25, amp: 0.10, color: 0x64748b },
};

export const ROLE_PRINCIPLE = {
  web: '接收来自 ToR 交换机的 HTTP/HTTPS 请求，由 CPU 解析协议、执行业务逻辑并返回页面或 API 响应。通常无状态、横向扩展，前端由负载均衡分发流量。',
  app: '运行核心业务代码（微服务/中间件），从 Web 层接收调用，访问数据库与缓存后返回结果。CPU 与内存是主要瓶颈，风扇转速随负载动态调节。',
  db: '持久化存储结构化数据。大量内存用作缓冲池加速查询，NVMe 盘承载事务日志与数据文件，RAID 卡提供磁盘级冗余。对温度与供电稳定性最敏感。',
  ai: '搭载多张 GPU 加速卡进行深度学习训练与推理。单机功耗可达数千瓦，需要高转速风扇与更强的冷通道送风，供电通过双路冗余 PSU 汇入。',
  storage: '提供分布式存储服务（对象/块/文件）。多块大容量硬盘经背板连接 RAID/HBA 卡，数据通过网卡在节点间复制以保证可靠性。',
  jbod: '纯磁盘扩展柜，不含 CPU 主板，仅有电源、风扇与 SAS 扩展器，由上方存储服务器通过 SAS 线缆级联管理其中的硬盘。',
};

// 服务器内部部件说明（拆解视图用）
export const COMPONENTS = {
  lid:       { name: '机箱顶盖',      desc: '钣金上盖，形成封闭风道，使前端风扇的冷风必须流经 CPU 散热片与内存后从尾部排出。' },
  disk:      { name: '前置硬盘',      desc: '热插拔硬盘托架（NVMe/SAS/SATA），通过背板与 RAID/HBA 卡连接。前面板 LED 指示活动与故障状态。' },
  backplane: { name: '硬盘背板',      desc: '把硬盘的电源与数据信号汇集后交给 RAID 卡或主板，支持热插拔不掉电更换。' },
  fan:       { name: '散热风扇墙',    desc: '一组冗余热插拔风扇，从冷通道抽入冷空气吹向 CPU/内存/GPU，再由尾部排至热通道。转速由 BMC 根据温度 PID 调节。' },
  mainboard: { name: '主板',          desc: '承载 CPU 插座、内存插槽、PCIe 通道、芯片组与 BMC 管理控制器；VRM 把 12V 转换为 CPU 所需的低压大电流。' },
  cpu:       { name: 'CPU 与散热片',  desc: '中央处理器执行指令；铜/铝散热片通过导热硅脂吸收热量，风扇吹过鳍片带走热量。每颗 CPU 热设计功耗 (TDP) 约 200-350W。' },
  dimm:      { name: '内存 DIMM',     desc: '多通道 DDR5 内存条，就近围绕 CPU 布置以缩短走线。ECC 校验可纠正单比特错误。' },
  gpu:       { name: 'GPU 加速卡',    desc: '数千 CUDA/张量核心并行计算，通过 PCIe/NVLink 与 CPU 及其他 GPU 通信。单卡功耗 300-700W，是机房最主要的热源之一。' },
  nic:       { name: '网卡 (NIC)',    desc: '25G/100G 以太网接口，通过 DAC 线缆或光纤连接机柜顶部 ToR 交换机，是服务器进出机房网络的唯一入口。' },
  raid:      { name: 'RAID / HBA 卡', desc: '连接硬盘背板，实现 RAID 0/1/5/10 冗余与缓存加速，缓存由超级电容在断电时保护。' },
  psu:       { name: '冗余电源 (PSU)', desc: '两路 80 Plus 铂金/钛金电源，各接一路 PDU（A/B 路），把 220V 交流整流为 12V 直流。任一路失效不影响运行。' },
  sas:       { name: 'SAS 扩展器',    desc: '把一条 SAS 链路扩展到多块硬盘，是 JBOD 的核心控制芯片。' },
};

// 其他设备的原理说明
export const EQUIP = {
  rack:        { name: '标准机柜', desc: '42U 标准机柜，宽 600mm 深 1200mm。前门朝向冷通道进风，后门朝向热通道排风。柜内设置零 U 垂直 PDU 为设备供电。' },
  tor:         { name: 'ToR 接入交换机', desc: 'Top-of-Rack 交换机位于机柜顶部，用短线缆下联本机柜所有服务器，用光纤上联核心/汇聚交换机，减少跨机柜布线。' },
  core:        { name: '核心交换机', desc: '机房网络的中枢，进行三层路由与 VLAN 转发，双机堆叠实现冗余。所有 ToR 都通过上联光纤汇聚到这里。' },
  firewall:    { name: '防火墙', desc: '对进出机房的流量进行安全策略检查（ACL、状态检测、IPS），阻断非法访问。' },
  router:      { name: '出口路由器', desc: '连接运营商线路与互联网，做 NAT 与 BGP 路由，是机房与外部世界的边界。' },
  oob:         { name: '带外管理交换机', desc: '独立于业务网络，连接所有服务器的 BMC/IPMI 口，即使业务网络故障也能远程开关机与查看硬件状态。' },
  patch:       { name: '光纤配线架', desc: '把核心交换机的上联光纤整齐端接，便于运维查找与更换。' },
  pdu:         { name: '机柜 PDU', desc: '零 U 垂直电源分配单元，安装在机柜后部两侧（A 路/B 路），带电流监测，把母线槽的电分配到每台服务器的电源。' },
  ups:         { name: '不间断电源 (UPS)', desc: '市电正常时整流-逆变输出纯净正弦波并给电池充电；市电中断时电池经逆变器无缝供电，为柴油发电机启动争取时间。' },
  battery:     { name: '电池柜', desc: '锂电/铅酸电池组，为 UPS 提供后备能量，通常按 15 分钟满载续航配置。' },
  pdc:         { name: '低压配电柜', desc: '接收市电与发电机的输入，经断路器、ATS 自动切换后送往 UPS 与空调等负载。' },
  busway:      { name: '母线槽', desc: '架空敷设的密集型母线，沿机柜排延伸，通过插接箱给每个机柜 PDU 取电，比电缆更易扩容。' },
  crac:        { name: '精密空调 (CRAC)', desc: '把热通道回风冷却至 18-22℃ 后由底部风机压入架空地板下的静压箱，再经冷通道的穿孔地板送出，恒温恒湿并可 N+1 冗余。' },
  tile:        { name: '穿孔地板', desc: '架空地板上开孔率 25-50% 的送风地板，把地板下的冷风送入封闭冷通道，是冷空气进入机柜的入口。' },
  containment: { name: '冷通道封闭', desc: '用顶板和端门把冷通道封闭起来，防止冷热空气混合，可显著提高空调效率、降低 PUE。' },
  tray:        { name: '网络桥架', desc: '架空线缆桥架，敷设 ToR 到核心交换机的光纤与铜缆，与强电母线槽分层敷设避免干扰。' },
  light:       { name: 'LED 照明', desc: '机房照明，通常联动人员感应。' },
};

export const NET_KINDS = {
  tor:      { name: 'ToR 交换机',   color: 0x1f3a5f, ports: 48 },
  core:     { name: '核心交换机',   color: 0x1e3a8a, ports: 32 },
  firewall: { name: '防火墙',       color: 0x7f1d1d, ports: 16 },
  router:   { name: '出口路由器',   color: 0x374151, ports: 8 },
  oob:      { name: '带外管理交换机', color: 0x3f3f46, ports: 48 },
  patch:    { name: '光纤配线架',   color: 0x27272a, ports: 24 },
};
