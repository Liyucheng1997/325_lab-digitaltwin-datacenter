// ============================================================
//  鼠标拾取：悬停高亮 + 点击选择
// ============================================================
import * as THREE from 'three';
import { highlight, unhighlight } from './util.js';

export class Interaction {
  constructor(app) {
    this.app = app;
    this.ray = new THREE.Raycaster();
    this.ray.params.Line.threshold = 0;
    this.ray.params.Points.threshold = 0;
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.needsPick = false;
    this.down = null;
    this.tooltip = document.getElementById('tooltip');
    this.mouse = { x: 0, y: 0 };
    const canvas = app.canvas;
    canvas.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.needsPick = true;
    });
    canvas.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, b: e.button }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.down || e.button !== 0) return;
      const d = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (d > 5) return;
      this.pick();
      this.app.select(this.hovered);
    });
    canvas.addEventListener('pointerleave', () => this.setHovered(null));
  }

  climb(o) {
    while (o) {
      const ud = o.userData;
      if (ud && ud.type) {
        if (ud.type === 'component') {
          const srv = ud.server;
          if (srv && srv.userData.explodeTarget < 0.5) return srv; // 未拆解时选择整机
        }
        return o;
      }
      o = o.parent;
    }
    return null;
  }

  pick() {
    this.ray.setFromCamera(this.pointer, this.app.camera);
    const hits = this.ray.intersectObject(this.app.world.group, true);
    let target = null;
    for (const h of hits) {
      if (h.object.isLine || h.object.isPoints) continue;
      if (!h.object.visible) continue;
      target = this.climb(h.object);
      if (target) break;
    }
    if (target && (target.userData.type === 'floor')) target = null;
    this.setHovered(target);
  }

  setHovered(obj) {
    if (obj === this.hovered) return;
    if (this.hovered && this.hovered !== this.app.selected) unhighlight(this.hovered);
    this.hovered = obj;
    if (obj) {
      if (obj !== this.app.selected) highlight(obj, 0x38bdf8, 0.35);
      const ud = obj.userData;
      let title = ud.name || ud.id, sub = '';
      if (ud.type === 'server') { title = ud.id; sub = `${this.app.roleName(ud.spec.role)} · ${ud.spec.rack} U${ud.spec.u} · ${ud.state.temp.toFixed(1)}℃ · ${Math.round(ud.state.load * 100)}%`; }
      else if (ud.type === 'component') { sub = ud.server?.userData.id || ''; }
      else if (ud.type === 'rack') { sub = `${ud.servers.length} 台服务器 · 点击查看`; }
      this.tooltip.innerHTML = `<div>${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
      this.tooltip.classList.remove('hidden');
      this.app.canvas.style.cursor = 'pointer';
    } else {
      this.tooltip.classList.add('hidden');
      this.app.canvas.style.cursor = '';
    }
  }

  update() {
    if (this.needsPick) { this.needsPick = false; this.pick(); }
    if (this.hovered) {
      this.tooltip.style.left = `${this.mouse.x + 14}px`;
      this.tooltip.style.top = `${this.mouse.y + 14}px`;
    }
  }
}
