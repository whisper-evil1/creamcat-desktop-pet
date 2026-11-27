/* 星宠语 · 3D 小屋
 * Three.js + room.gltf（独立几何体）+ A* 寻路 + WASD/点击移动 + 家具互动 + 自主行为
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NavGrid } from './nav.js';
import { loadRoom, ROOM_BOUNDS, INTERACTIVES } from './room.js';
import { Pet } from './pet.js';

const DATA = window.PET_DATA || [];
const $ = (s) => document.querySelector(s);

/* ---------------- 基础三件套 ---------------- */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5e8db);
scene.fog = new THREE.Fog(0xf5e8db, 20, 34);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(5.1, 4.5, 6.2);

/* ---------------- 灯光 ---------------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0xe4d0bd, 1.25);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff6ea, 2.4);
sun.position.set(-4.8, 6.6, -5.6);
sun.target.position.set(0.6, 0.4, 1.2);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const DS = 6.5;
sun.shadow.camera.left = -DS;
sun.shadow.camera.right = DS;
sun.shadow.camera.top = DS;
sun.shadow.camera.bottom = -DS;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 26;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const winLight = new THREE.DirectionalLight(0xdcecff, 0.6);
winLight.position.set(-2.05, 2.4, -6.5);
winLight.target.position.set(0.5, 0.4, 1.2);
scene.add(winLight);
scene.add(winLight.target);

const lamp = new THREE.PointLight(0xffcf94, 5, 4.5, 2);
lamp.position.set(3.32, 0.78, -2.42);
scene.add(lamp);

const fill = new THREE.PointLight(0xffe9d2, 9, 12, 2);
fill.position.set(0, 3.4, 3.2);
scene.add(fill);

/* ---------------- 镜头控制 ---------------- */
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0.1);
controls.enableDamping = true;
controls.dampingFactor = 0.085;
controls.enablePan = false;
controls.minDistance = 3.4;
controls.maxDistance = 10.5;
controls.minPolarAngle = 0.42;
controls.maxPolarAngle = 1.14;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.85;
controls.update();

/* ---------------- 房间 / 导航 ---------------- */
let room = null;
let nav = null;
let pet = null;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const state = {
  idx: 0,
  mood: 76,
  lv: 5,
  night: false,
  charm: '',
  busy: false
};

/* ---------------- 界面 ---------------- */
const bubble = $('#bubble');
let bubbleTimer = null;

function say(text, ms) {
  bubble.textContent = text;
  bubble.classList.add('on');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('on'), ms || 3800);
}

function placeBubble() {
  if (!pet) return;
  const v = new THREE.Vector3(pet.x, 1.34 + pet.baseY, pet.z);
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  bubble.style.left = x + 'px';
  bubble.style.top = y + 'px';
}

function refreshCard() {
  const p = DATA[state.idx];
  if (!p) return;
  $('#petName').textContent = p.name;
  $('#petAvatar').src = p.texture;
  $('#petLv').textContent = state.lv;
  $('#petMood').style.width = Math.round(state.mood) + '%';
  document.title = '星宠语 · ' + p.name + '的 3D 小屋';
}

/* ---------------- 目标点标记 ---------------- */
let mark = null;
function showMark(x, z) {
  if (!mark) {
    const g = new THREE.RingGeometry(0.13, 0.19, 24);
    mark = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0xffb27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
    }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = 0.015;
    scene.add(mark);
  }
  mark.position.set(x, 0.015, z);
  mark.scale.setScalar(1);
  mark.material.opacity = 0.9;
  mark.visible = true;
}

/* ---------------- 移动 ---------------- */
const keys = new Set();
let dpadDir = null;
let actionToken = 0;
let idleTimer = 2.5;

function actionLater(sec, fn) {
  const t = ++actionToken;
  setTimeout(() => { if (t === actionToken) fn(); }, sec * 1000);
  return t;
}

function moveVector() {
  let f = 0, r = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1;
  if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a') || keys.has('arrowleft')) r -= 1;
  if (keys.has('d') || keys.has('arrowright')) r += 1;
  if (dpadDir === 'up') f += 1;
  if (dpadDir === 'down') f -= 1;
  if (dpadDir === 'left') r -= 1;
  if (dpadDir === 'right') r += 1;
  return { f, r };
}

const RADIUS = 0.155;
function canStand(x, z) {
  return nav.walkableAtWorld(x, z) &&
    nav.walkableAtWorld(x + RADIUS, z) && nav.walkableAtWorld(x - RADIUS, z) &&
    nav.walkableAtWorld(x, z + RADIUS) && nav.walkableAtWorld(x, z - RADIUS);
}

function tryMove(dx, dz) {
  const nx = pet.x + dx, nz = pet.z + dz;
  if (canStand(nx, nz)) { pet.setPosition(nx, nz); return; }
  if (canStand(nx, pet.z)) { pet.setPosition(nx, pet.z); return; }
  if (canStand(pet.x, nz)) { pet.setPosition(pet.x, nz); }
}

const FWD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function handleMove(dt) {
  const { f, r } = moveVector();
  if (!f && !r) return false;

  camera.getWorldDirection(FWD);
  FWD.y = 0;
  FWD.normalize();
  RIGHT.crossVectors(FWD, UP).normalize();

  const dir = new THREE.Vector3()
    .addScaledVector(FWD, f)
    .addScaledVector(RIGHT, r);
  if (dir.lengthSq() < 1e-6) return false;
  dir.normalize();

  const speed = 1.55;
  tryMove(dir.x * speed * dt, dir.z * speed * dt);

  if (pet.isWalking()) { pet.stop(); actionToken++; }
  state.busy = false;
  pet.state = 'walk';
  pet.targetFacing = Math.atan2(dir.x, dir.z);
  if (mark) mark.visible = false;
  idleTimer = Math.max(idleTimer, 1.6);
  return true;
}

/* ---------------- 寻路 ---------------- */
function walkTo(x, z, done) {
  const path = nav.findPath(pet.x, pet.z, x, z);
  if (!path || !path.length) return false;
  pet.walkTo(path, done);
  return true;
}

function goInteract(key) {
  const cfg = INTERACTIVES[key];
  if (!cfg) return;
  state.busy = true;
  actionToken++;
  const ok = walkTo(cfg.anchor[0], cfg.anchor[1], () => doAction(key, cfg));
  if (!ok) {
    state.busy = false;
    say('那边过不去…绕一下好不好？');
    return;
  }
  if (mark) mark.visible = false;
  say(cfg.icon + ' 正在过去…', 1600);
}

function doAction(key, cfg) {
  state.busy = true;
  state.mood = Math.min(100, state.mood + 3);
  refreshCard();
  say(cfg.line);

  const release = (delay) => {
    actionLater(delay, () => {
      state.busy = false;
      pet.setState('idle');
      idleTimer = 2 + Math.random() * 3;
    });
  };

  switch (cfg.action) {
    case 'sleep':
      pet.setState('sleep');
      release(18);
      break;
    case 'rest':
      pet.setState('rest');
      release(12);
      break;
    case 'sit':
    case 'read':
    case 'watch':
      pet.setState(cfg.action === 'sit' ? 'sit' : cfg.action);
      release(8);
      break;
    case 'play': {
      // 球被踢到旁边，宠物跳着追
      const b = room.ball;
      if (b) {
        b.position.x += (Math.random() - 0.5) * 1.2;
        b.position.z += (Math.random() - 0.4) * 0.9;
        b.position.x = Math.max(-3.4, Math.min(3.4, b.position.x));
        b.position.z = Math.max(-2.4, Math.min(2.6, b.position.z));
      }
      pet.setState('play');
      actionLater(3.2, () => {
        pet.setState('idle');
        state.busy = false;
        idleTimer = 2.5;
      });
      break;
    }
    case 'climb': {
      const px = pet.x, pz = pet.z;
      pet.climbTo(1.18, 1.2, () => {
        pet.setState('climb');      // 停在平台上，别掉下来
        actionLater(7, () => {
          pet.climbTo(0, 1.0, () => {
            pet.setState('idle');
            pet.setPosition(px, pz);
            state.busy = false;
            idleTimer = 2.5;
          });
        });
      });
      break;
    }
    default:
      pet.setState('idle');
      release(4);
  }
}

/* ---------------- 点击 ---------------- */
let downPoint = null;
let dragged = false;

canvas.addEventListener('pointerdown', (e) => {
  downPoint = { x: e.clientX, y: e.clientY };
  dragged = false;
});

canvas.addEventListener('pointermove', (e) => {
  if (!downPoint) return;
  if (Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) > 6) {
    dragged = true;
    canvas.classList.add('dragging');
  }
});

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('dragging');
  const wasDrag = dragged;
  downPoint = null;
  dragged = false;
  if (wasDrag) return;
  handleClick(e.clientX, e.clientY);
});

canvas.addEventListener('pointercancel', () => {
  downPoint = null;
  dragged = false;
  canvas.classList.remove('dragging');
});

function handleClick(cx, cy) {
  if (!room || !pet) return;
  const ndc = new THREE.Vector2(
    (cx / window.innerWidth) * 2 - 1,
    -(cy / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects(room.hitList, false);
  if (hits.length) {
    const key = hits[0].object.userData.interact;
    if (key) { goInteract(key); return; }
  }

  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, p)) {
    const x = Math.max(ROOM_BOUNDS.minX + 0.2, Math.min(ROOM_BOUNDS.maxX - 0.2, p.x));
    const z = Math.max(ROOM_BOUNDS.minZ + 0.2, Math.min(ROOM_BOUNDS.maxZ - 0.2, p.z));
    if (walkTo(x, z)) {
      showMark(x, z);
      state.busy = false;
      actionToken++;
      hideSheet();
      idleTimer = 2.4;
    }
  }
}

/* ---------------- 自主行为 ---------------- */
const SPOTS = [
  [-2.05, -2.05], [1.95, -0.85], [-2.35, 1.22], [3.2, 2.0], [0.6, 0.4], [-1.2, 1.9]
];

function autonomous(dt) {
  if (state.busy || pet.isWalking() || pet.state === 'climb') return;
  idleTimer -= dt;
  if (idleTimer > 0) return;
  idleTimer = 3.2 + Math.random() * 4.5;

  const r = Math.random();
  if (r < 0.44) {
    const p = nav.randomPoint();
    if (p && walkTo(p.x, p.z)) {
      if (mark) mark.visible = false;
      return;
    }
  }
  if (r < 0.62) {
    // 停下来看看
    pet.setState('idle');
    pet.targetFacing = pet.facing + (Math.random() - 0.5) * 2.6;
    return;
  }
  if (r < 0.78) {
    pet.setState('sit', 3.6);
    actionLater(3.6, () => pet.setState('idle'));
    return;
  }
  if (r < 0.92) {
    const s = SPOTS[Math.floor(Math.random() * SPOTS.length)];
    if (walkTo(s[0], s[1], () => {
      if (Math.random() < 0.5) {
        pet.setState('watch');
        actionLater(6, () => pet.setState('idle'));
      }
    })) return;
  }
  pet.setState('idle');
}

/* ---------------- 换宠物 / 心情 ---------------- */
function switchPet(step) {
  state.idx = (state.idx + (step || 1) + DATA.length) % DATA.length;
  pet.setPet(DATA[state.idx]);
  refreshCard();
  say(DATA[state.idx].quote || '我来啦～');
  actionToken++;
  state.busy = false;
  pet.setState('idle');
  state.mood = Math.min(100, state.mood + 2);
  refreshCard();
}

/* ---------------- 昼夜 ---------------- */
function setNight(on) {
  state.night = !!on;
  hemi.intensity = on ? 0.36 : 1.15;
  hemi.color.setHex(on ? 0xa8bce0 : 0xfff4e8);
  hemi.groundColor.setHex(on ? 0x5b4c62 : 0xd9c2ad);
  sun.intensity = on ? 0.6 : 2.5;
  sun.color.setHex(on ? 0xc3d4f5 : 0xfff0da);
  winLight.intensity = on ? 0.75 : 0.6;
  winLight.color.setHex(on ? 0x9dc2ff : 0xdcecff);
  lamp.intensity = on ? 14 : 5;
  fill.intensity = on ? 1.2 : 9;
  scene.background.setHex(on ? 0x2c3550 : 0xf5e8db);
  scene.fog.color.setHex(on ? 0x2c3550 : 0xf5e8db);
  if (room && room.night.sky) {
    room.night.sky.material.color.setHex(on ? 0x24304d : 0xc7e7ff);
  }
  if (pet) pet.mesh.material.color.setHex(on ? 0xd8d2e6 : 0xffffff);
  $('#btnNight').textContent = on ? '🌙' : '☀';
  $('#btnNight').classList.toggle('on', on);
}

/* ---------------- 装扮（头顶挂件） ---------------- */
let charmSprite = null;
function emojiTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.font = '72px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 48, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function setCharm(ch) {
  if (charmSprite) {
    pet.group.remove(charmSprite);
    charmSprite.material.map.dispose();
    charmSprite.material.dispose();
    charmSprite = null;
  }
  state.charm = ch;
  if (!ch) return;
  charmSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: emojiTexture(ch), transparent: true, depthWrite: false
  }));
  charmSprite.scale.set(0.26, 0.26, 1);
  charmSprite.position.set(0, 0.76, 0);
  pet.group.add(charmSprite);
}

/* ---------------- 面板 ---------------- */
const sheet = $('#sheet');
const sheetBody = $('#sheetBody');

function hideSheet() {
  sheet.classList.remove('on');
  sheet.setAttribute('aria-hidden', 'true');
  $('#btnInteract').classList.remove('on');
  $('#btnToy').classList.remove('on');
  $('#btnLook').classList.remove('on');
}

function openSheet(title, html, btn) {
  $('#sheetTitle').textContent = title;
  sheetBody.innerHTML = html;
  sheet.classList.add('on');
  sheet.setAttribute('aria-hidden', 'false');
  ['#btnInteract', '#btnToy', '#btnLook'].forEach((s) => $(s).classList.remove('on'));
  if (btn) $(btn).classList.add('on');
}

function sheetInteract() {
  const rows = Object.entries(INTERACTIVES).map(([key, cfg]) =>
    `<button class="item" data-act="${key}">
       <span class="ic">${cfg.icon}</span>
       <span class="tx"><b>${cfg.label}</b><small>会自己走过去</small></span>
       <span class="go">›</span>
     </button>`).join('');
  openSheet('想让它做什么？', rows, '#btnInteract');
}

const CHARMS = [
  ['', '○', '素净', '什么都不戴'],
  ['🌸', '🌸', '樱花', '春天的小心思'],
  ['⭐', '⭐', '星光', '夜里也亮亮的'],
  ['🎀', '🎀', '缎带', '今天想被夸']
];

function sheetLook() {
  const rows = CHARMS.map(([ch, ic, nm, ds]) =>
    `<button class="item" data-charm="${ch}">
       <span class="ic">${ic}</span>
       <span class="tx"><b>${nm}</b><small>${ds}</small></span>
       <span class="go">${state.charm === ch ? '✓' : '›'}</span>
     </button>`).join('');
  openSheet('给它挑个小装饰', rows, '#btnLook');
}

function sheetToy() {
  const rows = `
    <button class="item" data-toy="ball">
      <span class="ic">🎾</span>
      <span class="tx"><b>丢一个球</b><small>它会跑过去追</small></span><span class="go">›</span>
    </button>
    <button class="item" data-toy="hide">
      <span class="ic">🫥</span>
      <span class="tx"><b>躲猫猫</b><small>让它去猫窝里待着</small></span><span class="go">›</span>
    </button>`;
  openSheet('想玩点什么？', rows, '#btnToy');
}

/* ---------------- 事件绑定 ---------------- */
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    e.preventDefault();
  }
  keys.add(k);
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// D-pad
const dpad = $('#dpad');
dpad.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  e.preventDefault();
  dpadDir = b.dataset.dir;
  b.classList.add('active');
  b.setPointerCapture(e.pointerId);
});
function clearDpad() {
  dpadDir = null;
  dpad.querySelectorAll('.d').forEach((x) => x.classList.remove('active'));
}
dpad.addEventListener('pointerup', clearDpad);
dpad.addEventListener('pointercancel', clearDpad);
dpad.addEventListener('pointerleave', clearDpad);

// 工具
$('#btnCam').addEventListener('click', () => {
  camera.position.set(5.1, 4.5, 6.2);
  controls.target.set(0, 0.8, 0.1);
  controls.update();
});
$('#btnNight').addEventListener('click', () => setNight(!state.night));
$('#btnSwitch').addEventListener('click', () => switchPet(1));
$('#btnHeart').addEventListener('click', () => {
  state.mood = Math.min(100, state.mood + 4);
  refreshCard();
  pet.setState('play');
  actionLater(1.4, () => pet.setState('idle'));
  say('嘿嘿…再摸一下。');
  heartBurst();
});

function heartBurst() {
  const el = document.createElement('div');
  el.textContent = '❤';
  el.style.cssText = 'position:fixed;z-index:30;pointer-events:none;font-size:20px;color:#f79aa8;' +
    'left:' + (window.innerWidth * 0.5) + 'px;top:' + (window.innerHeight * 0.5) + 'px;' +
    'transition:transform .9s ease-out, opacity .9s;';
  document.body.appendChild(el);
  const v = new THREE.Vector3(pet.x, 0.8, pet.z).project(camera);
  el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  requestAnimationFrame(() => {
    el.style.transform = 'translate(-50%,-160%) scale(1.5)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 1000);
}

$('#btnInteract').addEventListener('click', () => {
  if (sheet.classList.contains('on') && $('#btnInteract').classList.contains('on')) hideSheet();
  else sheetInteract();
});
$('#btnToy').addEventListener('click', () => {
  if (sheet.classList.contains('on') && $('#btnToy').classList.contains('on')) hideSheet();
  else sheetToy();
});
$('#btnLook').addEventListener('click', () => {
  if (sheet.classList.contains('on') && $('#btnLook').classList.contains('on')) hideSheet();
  else sheetLook();
});
$('#sheetClose').addEventListener('click', hideSheet);

sheetBody.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    hideSheet();
    goInteract(act.dataset.act);
    return;
  }
  const ch = e.target.closest('[data-charm]');
  if (ch) {
    setCharm(ch.dataset.charm);
    hideSheet();
    say(state.charm ? '好看吗？我戴了一整天。' : '素净也很好看。');
    return;
  }
  const toy = e.target.closest('[data-toy]');
  if (toy) {
    hideSheet();
    if (toy.dataset.toy === 'ball') {
      const b = room.ball;
      if (b) {
        b.position.set(
          Math.max(-3.2, Math.min(3.2, pet.x + (Math.random() - 0.5) * 2.2)),
          0.1,
          Math.max(-2.2, Math.min(2.6, pet.z + (Math.random() - 0.5) * 2.0))
        );
      }
      goInteract('toy-ball');
    } else {
      goInteract('cat-house');
    }
  }
});

// 点了界面以外的地板就收起面板
document.addEventListener('pointerdown', (e) => {
  if (!sheet.classList.contains('on')) return;
  if (sheet.contains(e.target) || e.target.closest('.actions')) return;
  hideSheet();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();

function camYaw() {
  return Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
}

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  const yaw = camYaw();

  const moving = handleMove(dt);
  if (!moving && pet && !pet.isWalking() && pet.state === 'walk') {
    pet.setState('idle');
    idleTimer = Math.max(idleTimer, 1.2);
  }

  if (pet) {
    pet.update(dt, yaw);
    autonomous(dt);
    placeBubble();
  }

  if (mark && mark.visible) {
    mark.scale.setScalar(1 + Math.sin(performance.now() * 0.005) * 0.09);
    mark.material.opacity = 0.55 + Math.sin(performance.now() * 0.005) * 0.3;
  }

  // 心情随时间缓慢下降
  state.mood = Math.max(12, state.mood - dt * 0.35);
  if (Math.floor(performance.now() / 1000) % 3 === 0) refreshCard();

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ---------------- 启动 ---------------- */
async function boot() {
  if (!DATA.length) {
    $('.loader-text').textContent = '没有找到宠物数据（../showcase/data/pets.js）';
    return;
  }

  room = await loadRoom(scene);

  nav = new NavGrid(ROOM_BOUNDS.minX + 0.18, ROOM_BOUNDS.maxX - 0.18,
    ROOM_BOUNDS.minZ + 0.18, ROOM_BOUNDS.maxZ - 0.18, 0.2);
  nav.build(room.boxes, 0.13);

  pet = new Pet(scene);
  pet.setPet(DATA[state.idx]);
  pet.setPosition(0, 1.75);
  pet.facing = Math.PI;
  pet.targetFacing = Math.PI;

  // 窗光落在地上的一块柔光（纯加分项，和模型无关）
  (function sunPatch() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,248,232,0.9)');
    grd.addColorStop(0.45, 'rgba(255,243,220,0.4)');
    grd.addColorStop(1, 'rgba(255,243,220,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.8),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.42, depthWrite: false })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(-1.55, 0.016, -1.15);
    scene.add(patch);
  })();

  refreshCard();
  $('#loader').classList.add('hide');

  // 调试出口（自动化测试 / 控制台手玩）
  window.__r3d = { scene, camera, controls, nav, pet, room, state, walkTo, goInteract, setNight, switchPet };
  clock.start();

  setTimeout(() => say(DATA[state.idx].quote || '这个房间，是我一个人的吗？', 4200), 700);
  setTimeout(() => $('#hint').classList.add('fade'), 9000);

  tick();
}

boot().catch((err) => {
  console.error(err);
  const t = document.querySelector('.loader-text');
  if (t) t.textContent = '小屋加载失败：' + (err && err.message ? err.message : err);
});
