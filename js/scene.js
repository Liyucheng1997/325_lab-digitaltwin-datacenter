import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { easeInOut } from './util.js';

export const VIEWS = {
  overview: { pos: [13, 9.5, 13], tgt: [-1.5, 1.0, 0] },
  cold:     { pos: [3.2, 1.5, 0.1], tgt: [-5, 1.1, 0] },
  hot:      { pos: [3.2, 1.7, -3.4], tgt: [-5, 1.1, -3.0] },
  core:     { pos: [1.7, 2.5, 1.5], tgt: [4.0, 1.2, 0] },
  power:    { pos: [-5.0, 2.6, 4.0], tgt: [-9.6, 1.1, 0.5] },
  crac:     { pos: [0, 3.2, -2.5], tgt: [0, 1.0, -6.9] },
  top:      { pos: [-1, 22, 0.5], tgt: [-1, 0, 0] },
};

export function createScene(canvas, labelContainer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);
  scene.fog = new THREE.Fog(0x0a1020, 34, 70);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  camera.position.set(...VIEWS.overview.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.01;
  controls.minDistance = 0.25;
  controls.maxDistance = 48;
  controls.target.set(...VIEWS.overview.tgt);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });

  // 灯光
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1b2230, 0.9));
  scene.add(new THREE.AmbientLight(0x8fa8cc, 0.45));
  // 冷通道内补光
  for (const [x, z] of [[-4, 0], [-1, 0], [2, 0], [2.6, 0], [-7.5, 0.5], [-4, -3.4], [-4, 3.4], [1, -3.4], [1, 3.4]]) {
    const p = new THREE.PointLight(0x9ec5ff, 6, 7, 1.6);
    p.position.set(x, 2.4, z);
    scene.add(p);
  }
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(8, 14, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -14; dir.shadow.camera.right = 14;
  dir.shadow.camera.top = 12; dir.shadow.camera.bottom = -12;
  dir.shadow.camera.near = 1; dir.shadow.camera.far = 40;
  dir.shadow.bias = -0.0008;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x7fb3ff, 0.5);
  fill.position.set(-10, 8, -6);
  scene.add(fill);

  // 相机飞行
  const fly = { active: false, t: 0, dur: 1.2, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3(), resolve: null };
  function flyTo(pos, tgt, dur = 1.2) {
    fly.fromPos.copy(camera.position);
    fly.fromTgt.copy(controls.target);
    fly.toPos.set(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2]);
    fly.toTgt.set(tgt.x ?? tgt[0], tgt.y ?? tgt[1], tgt.z ?? tgt[2]);
    fly.t = 0; fly.dur = dur; fly.active = true;
    return new Promise((res) => { fly.resolve = res; });
  }
  function flyView(name, dur) { const v = VIEWS[name]; return flyTo(v.pos, v.tgt, dur); }

  function update(dt) {
    if (fly.active) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const e = easeInOut(fly.t);
      camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
      controls.target.lerpVectors(fly.fromTgt, fly.toTgt, e);
      if (fly.t >= 1) { fly.active = false; fly.resolve?.(); fly.resolve = null; }
    }
    controls.update();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function render() {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  window.addEventListener('resize', resize);
  resize();

  // 用户拖动时打断飞行
  canvas.addEventListener('pointerdown', () => { if (fly.active) { fly.active = false; fly.resolve?.(); fly.resolve = null; } });

  return { renderer, scene, camera, controls, labelRenderer, flyTo, flyView, update, resize, render };
}
