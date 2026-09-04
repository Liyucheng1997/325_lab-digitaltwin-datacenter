import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5, ...opts });
}
export function glass(color, opacity = 0.15) {
  return new THREE.MeshStandardMaterial({ color, transparent: true, opacity, metalness: 0.1, roughness: 0.2, depthWrite: false });
}
export function led(color, intensity = 1.6) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });
  return m;
}

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function label(text, cls = 'lbl', x = 0, y = 0, z = 0) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.set(x, y, z);
  return obj;
}

// 折线路径 -> CurvePath（等弧长参数）
export function polyline(points) {
  const path = new THREE.CurvePath();
  for (let i = 0; i < points.length - 1; i++) {
    path.add(new THREE.LineCurve3(points[i].clone(), points[i + 1].clone()));
  }
  return path;
}

// 画布纹理：交换机端口面板
export function portTexture(ports, color = '#0f172a') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 512, 64);
  const cols = Math.min(ports, 24), rows = ports > 24 ? 2 : 1;
  const pw = 14, ph = 12, gap = 4;
  const startX = 30;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = startX + i * (pw + gap) + (i >= 12 ? 16 : 0);
      const y = rows === 1 ? 26 : 12 + r * 24;
      g.fillStyle = '#1e293b'; g.fillRect(x, y, pw, ph);
      g.fillStyle = Math.random() > 0.35 ? '#22c55e' : '#334155';
      g.fillRect(x + 2, y + ph - 3, 4, 2);
      g.fillStyle = Math.random() > 0.5 ? '#f59e0b' : '#334155';
      g.fillRect(x + 8, y + ph - 3, 4, 2);
    }
  }
  // 上联光口
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#0ea5e9'; g.fillRect(470 + (i % 2) * 18, 12 + Math.floor(i / 2) * 24, 14, 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 画布纹理：穿孔地板
export function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3b4656'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#0f172a';
  for (let y = 8; y < 128; y += 12) for (let x = 8; x < 128; x += 12) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 画布纹理：空调格栅
export function grilleTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#111827'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#4b5563';
  for (let y = 4; y < 64; y += 8) g.fillRect(0, y, 256, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 圆点精灵纹理（粒子）
export function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---- 高亮：克隆材质并设置自发光，可恢复 ----
export function highlight(root, color = 0x38bdf8, intensity = 0.55) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isLed || o.userData.noHighlight) return;
    if (!o.userData._orig) o.userData._orig = o.material;
    const m = o.userData._orig.clone();
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = intensity;
    o.material = m;
  });
}
export function unhighlight(root) {
  root.traverse((o) => {
    if (o.isMesh && o.userData._orig) {
      o.material.dispose?.();
      o.material = o.userData._orig;
      delete o.userData._orig;
    }
  });
}

export function worldPos(obj, local = new THREE.Vector3()) {
  return obj.localToWorld(local.clone());
}

export function tempColor(t) {
  // 18℃ 蓝 → 40℃ 绿 → 60℃ 黄 → 80℃ 红
  const c = new THREE.Color();
  const k = clamp((t - 18) / 62, 0, 1);
  c.setHSL(lerp(0.62, 0.0, k), 0.9, 0.5);
  return c;
}

export function fmt(v, d = 1) { return Number(v).toFixed(d); }
