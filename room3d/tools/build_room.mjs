/* 生成 3D 小屋：程序化几何 -> room.gltf
 *
 * 不用任何房间贴图，全部是独立几何体（每个家具一个命名 Group），
 * 前端 GLTFLoader 加载后按节点名建碰撞盒与互动点。
 *
 * 房间：x ∈ [-4, 4]，z ∈ [-3, 3]，墙高 2.8，地板 y = 0
 * 运行：node build_room.mjs
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'assets', 'room.gltf');

// node 里没有 FileReader（GLTFExporter 用它把 buffer 转 base64），补一个最小实现
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const type = blob.type || 'application/octet-stream';
        this.result = 'data:' + type + ';base64,' + Buffer.from(buf).toString('base64');
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

const C = {
  floor: 0xf0d5b6,
  floorLine: 0xe2bd99,
  wall: 0xfffaf4,
  wallLow: 0xf6e4d6,
  trim: 0xfffbf6,
  wood: 0xead9bd,
  woodDeep: 0xd8c0a0,
  bedFrame: 0xe7d2b0,
  quilt: 0xcfead4,
  quiltAlt: 0xeaf7ec,
  sheet: 0xfffdf8,
  pillow: 0xfff8ee,
  green: 0xd7ecd2,
  greenDeep: 0xb9dcb2,
  cream: 0xf7efe2,
  pink: 0xfbdcd8,
  pinkDeep: 0xf3bdb8,
  grey: 0xcfd6d3,
  glass: 0xbfe4ff,
  sky: 0xc7e7ff,
  cloud: 0xffffff,
  leaf: 0x8fc98a,
  leafDeep: 0x6fae74,
  pot: 0xf5e6d6,
  potDeep: 0xe2cdb6,
  book: [0xf3a9a9, 0xa9c8f3, 0xf3d9a9, 0xb7e0b7, 0xd9b7e0, 0xf6c6a8],
  lamp: 0xfff0c8,
  brown: 0xb08a63,
  white: 0xffffff,
  shadow: 0x8a7058
};

const root = new THREE.Group();
root.name = 'ROOM';

function M(color, rough = 0.9, metal = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(name, w, h, d, color, x, y, z, parent, rough) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color, rough));
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || root).add(m);
  return m;
}

function cyl(name, rt, rb, h, seg, color, x, y, z, parent, rough) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(color, rough));
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || root).add(m);
  return m;
}

function ball(name, r, color, x, y, z, parent, seg = 18) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), M(color));
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || root).add(m);
  return m;
}

function group(name) {
  const g = new THREE.Group();
  g.name = name;
  root.add(g);
  return g;
}

/* ---------------- 房间壳 ---------------- */
const shell = group('shell');

// 窗户尺寸（后墙要按它开洞）
const WX = -2.05, WY = 1.62, WW = 2.5, WH = 1.55;
const WIN = { x0: WX - WW / 2, x1: WX + WW / 2, y0: WY - WH / 2, y1: WY + WH / 2 };

// 地板 + 木条
box('floor', 8, 0.12, 6, C.floor, 0, -0.06, 0, shell, 0.95);
for (let i = 0; i < 19; i++) {
  const z = -3 + 0.16 + i * 0.32;
  box('floor-line', 7.96, 0.004, 0.012, C.floorLine, 0, 0.002, z, shell, 0.95);
}
for (let i = 0; i < 9; i++) {
  const x = -4 + 0.5 + i * 0.9;
  box('floor-seam', 0.012, 0.004, 5.96, C.floorLine, x, 0.002, 0, shell, 0.95);
}

// 墙（后 / 左 / 右，前面留空方便看）
// 后墙分四块，给窗户留出真正的洞口（不是贴一张图）
const WZ = -3.06;
box('wall-back-l', WIN.x0 + 4, 2.8, 0.12, C.wall, (-4 + WIN.x0) / 2, 1.4, WZ, shell);
box('wall-back-r', 4 - WIN.x1, 2.8, 0.12, C.wall, (WIN.x1 + 4) / 2, 1.4, WZ, shell);
box('wall-back-b', WIN.x1 - WIN.x0, WIN.y0, 0.12, C.wall, WX, WIN.y0 / 2, WZ, shell);
box('wall-back-t', WIN.x1 - WIN.x0, 2.8 - WIN.y1, 0.12, C.wall, WX, (WIN.y1 + 2.8) / 2, WZ, shell);
box('wall-left', 0.12, 2.8, 6, C.wall, -4.06, 1.4, 0, shell);
box('wall-right', 0.12, 2.8, 4.2, C.wall, 4.06, 1.4, -0.9, shell);

// 踢脚线
box('trim-back', 8, 0.14, 0.04, C.trim, 0, 0.07, -2.98, shell);
box('trim-left', 0.04, 0.14, 6, C.trim, -3.98, 0.07, 0, shell);
box('trim-right', 0.04, 0.14, 4.2, C.trim, 3.98, 0.07, -0.9, shell);
box('trim-back-2', 8, 0.06, 0.05, C.wallLow, 0, 2.66, -2.97, shell);

/* ---------------- 窗户（后墙左侧） ---------------- */
const win = group('window');
// 窗外景（放在墙外面，透过洞能看见）
box('sky', WW + 1.2, WH + 0.6, 0.04, C.sky, WX, WY + 0.04, -3.42, win, 1);
ball('cloud-1', 0.26, C.cloud, WX - 0.75, WY + 0.42, -3.38, win);
ball('cloud-2', 0.18, C.cloud, WX - 0.45, WY + 0.34, -3.38, win);
ball('cloud-3', 0.22, C.cloud, WX + 0.62, WY + 0.5, -3.38, win);
// 窗外樱花（在洞口外侧，斜着探进来一点）
cyl('sakura-trunk', 0.06, 0.07, 0.9, 8, 0x9c7a63, WX + 0.82, WY - 0.55, -3.36, win);
ball('sakura-a', 0.34, 0xf9bccd, WX + 0.82, WY - 0.02, -3.36, win);
ball('sakura-b', 0.24, 0xffd2de, WX + 0.5, WY - 0.14, -3.36, win);
ball('sakura-c', 0.22, 0xffe3ea, WX + 1.12, WY - 0.08, -3.36, win);
ball('sakura-d', 0.18, 0xfff0f4, WX - 0.9, WY - 0.3, -3.36, win);
// 玻璃
const glass = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshStandardMaterial({
  color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.1, metalness: 0
}));
glass.name = 'window-glass';
glass.position.set(WX, WY, -3.05);
win.add(glass);
// 窗框
box('frame-top', WW + 0.12, 0.07, 0.14, C.trim, WX, WY + WH / 2, -3.03, win);
box('frame-bottom', WW + 0.12, 0.07, 0.14, C.trim, WX, WY - WH / 2, -3.03, win);
box('frame-left', 0.07, WH, 0.14, C.trim, WX - WW / 2, WY, -3.03, win);
box('frame-right', 0.07, WH, 0.14, C.trim, WX + WW / 2, WY, -3.03, win);
box('frame-mid', 0.05, WH, 0.1, C.trim, WX, WY, -3.03, win);
// 窗台
box('sill', WW + 0.34, 0.07, 0.24, C.trim, WX, WY - WH / 2 - 0.07, -2.92, win);
// 窗帘
box('curtain-l', 0.3, 2.15, 0.12, 0xfff6f2, WIN.x0 - 0.16, 1.62, -2.88, win, 0.98);
box('curtain-r', 0.3, 2.15, 0.12, 0xfff6f2, WIN.x1 + 0.16, 1.62, -2.88, win, 0.98);

/* ---------------- 书架 ---------------- */
const shelf = group('bookshelf');
const SX = -0.5, SZ = -2.68, SW = 1.5, SH = 1.72, SD = 0.36;
box('shelf-side-l', 0.06, SH, SD, C.wood, SX - SW / 2, SH / 2, SZ, shelf);
box('shelf-side-r', 0.06, SH, SD, C.wood, SX + SW / 2, SH / 2, SZ, shelf);
box('shelf-top', SW, 0.06, SD, C.wood, SX, SH, SZ, shelf);
box('shelf-back', SW, SH, 0.05, C.cream, SX, SH / 2, SZ - SD / 2 + 0.03, shelf);
for (let i = 0; i < 3; i++) {
  box('shelf-board', SW, 0.05, SD - 0.02, C.wood, SX, 0.34 + i * 0.46, SZ, shelf);
}
// 书
let bookSeed = 0;
for (let r = 0; r < 3; r++) {
  const y = 0.38 + r * 0.46;
  let x = SX - SW / 2 + 0.12;
  while (x < SX + SW / 2 - 0.12) {
    const w = 0.05 + (bookSeed % 3) * 0.018;
    const h = 0.2 + ((bookSeed * 7) % 5) * 0.016;
    box('book', w, h, 0.24, C.book[bookSeed % C.book.length], x, y + h / 2, SZ + 0.02, shelf);
    x += w + 0.012;
    bookSeed++;
  }
}
// 柜门
box('shelf-door-l', SW / 2 - 0.05, 0.3, 0.03, C.woodDeep, SX - SW / 4, 0.17, SZ + SD / 2 - 0.01, shelf);
box('shelf-door-r', SW / 2 - 0.05, 0.3, 0.03, C.woodDeep, SX + SW / 4, 0.17, SZ + SD / 2 - 0.01, shelf);
ball('shelf-knob-l', 0.022, 0xfff6e6, SX - 0.06, 0.17, SZ + SD / 2 + 0.01, shelf, 10);
ball('shelf-knob-r', 0.022, 0xfff6e6, SX + 0.06, 0.17, SZ + SD / 2 + 0.01, shelf, 10);
// 架上绿植
cyl('pot-shelf', 0.09, 0.07, 0.16, 12, C.pot, SX + 0.56, SH + 0.11, SZ, shelf);
ball('leaf-shelf-1', 0.12, C.leaf, SX + 0.56, SH + 0.26, SZ, shelf);
ball('leaf-shelf-2', 0.09, C.leafDeep, SX + 0.64, SH + 0.22, SZ + 0.03, shelf);
box('star-light', 0.22, 0.22, 0.06, C.lamp, SX - 0.5, SH + 0.2, SZ - 0.05, shelf);

/* ---------------- 床 ---------------- */
const bed = group('bed');
const BX = 1.95, BZ = -2.02, BW = 2.1, BD = 1.68;
box('bed-frame', BW, 0.16, BD, C.bedFrame, BX, 0.32, BZ, bed);
box('bed-leg-a', 0.09, 0.24, 0.09, C.woodDeep, BX - BW / 2 + 0.08, 0.12, BZ - BD / 2 + 0.08, bed);
box('bed-leg-b', 0.09, 0.24, 0.09, C.woodDeep, BX + BW / 2 - 0.08, 0.12, BZ - BD / 2 + 0.08, bed);
box('bed-leg-c', 0.09, 0.24, 0.09, C.woodDeep, BX - BW / 2 + 0.08, 0.12, BZ + BD / 2 - 0.08, bed);
box('bed-leg-d', 0.09, 0.24, 0.09, C.woodDeep, BX + BW / 2 - 0.08, 0.12, BZ + BD / 2 - 0.08, bed);
box('mattress', BW - 0.08, 0.18, BD - 0.1, C.sheet, BX, 0.49, BZ, bed, 0.98);
// 被子（绿格）
box('quilt', BW - 0.06, 0.1, BD - 0.34, C.quilt, BX, 0.61, BZ + 0.12, bed, 0.98);
for (let i = 0; i < 5; i++) {
  box('quilt-line-x', BW - 0.08, 0.008, 0.02, C.quiltAlt, BX, 0.663, BZ - 0.06 + i * 0.24, bed, 1);
}
for (let i = 0; i < 4; i++) {
  box('quilt-line-z', 0.02, 0.008, BD - 0.36, C.quiltAlt, BX - 0.72 + i * 0.48, 0.663, BZ + 0.12, bed, 1);
}
// 枕头
box('pillow-l', 0.62, 0.14, 0.34, C.pillow, BX - 0.45, 0.66, BZ - 0.56, bed, 0.98);
box('pillow-r', 0.62, 0.14, 0.34, C.pillow, BX + 0.45, 0.66, BZ - 0.56, bed, 0.98);
// 床头板（猫耳）
box('headboard', BW + 0.06, 0.86, 0.1, C.bedFrame, BX, 0.72, BZ - BD / 2 - 0.02, bed);
ball('headboard-ear-l', 0.13, C.bedFrame, BX - BW / 2 + 0.18, 1.2, BZ - BD / 2 - 0.02, bed);
ball('headboard-ear-r', 0.13, C.bedFrame, BX + BW / 2 - 0.18, 1.2, BZ - BD / 2 - 0.02, bed);
box('headboard-star', 0.16, 0.16, 0.03, 0xfff2cf, BX, 0.86, BZ - BD / 2 + 0.04, bed);

/* ---------------- 床头柜 ---------------- */
const night = group('nightstand');
box('ns-body', 0.5, 0.46, 0.42, C.wood, 3.32, 0.25, -2.42, night);
box('ns-top', 0.54, 0.04, 0.46, C.woodDeep, 3.32, 0.5, -2.42, night);
box('ns-drawer', 0.42, 0.16, 0.02, C.woodDeep, 3.32, 0.32, -2.2, night);
box('ns-drawer2', 0.42, 0.16, 0.02, C.woodDeep, 3.32, 0.13, -2.2, night);
ball('ns-knob', 0.024, 0xfff6e6, 3.32, 0.32, -2.18, night, 10);
// 星星灯
cyl('ns-lamp-base', 0.06, 0.07, 0.06, 12, C.cream, 3.32, 0.53, -2.42, night);
ball('ns-lamp-star', 0.11, 0xfff4c9, 3.32, 0.68, -2.42, night);

/* ---------------- 猫爬架（左后角） ---------------- */
const tree = group('cat-tree');
const TX = -3.35, TZ = -1.9;
box('tree-base', 0.92, 0.12, 0.92, C.green, TX, 0.06, TZ, tree);
cyl('tree-post', 0.09, 0.09, 1.0, 12, C.cream, TX - 0.12, 0.62, TZ - 0.1, tree, 0.98);
cyl('tree-platform', 0.34, 0.34, 0.1, 20, C.green, TX - 0.12, 1.16, TZ - 0.1, tree);
cyl('tree-pad-top', 0.24, 0.24, 0.05, 20, C.quiltAlt, TX - 0.12, 1.23, TZ - 0.1, tree);
cyl('tree-post-2', 0.08, 0.08, 0.62, 12, C.cream, TX + 0.22, 0.43, TZ + 0.2, tree, 0.98);
cyl('tree-platform-2', 0.26, 0.26, 0.09, 20, C.greenDeep, TX + 0.22, 0.78, TZ + 0.2, tree);
// 软窝（底座上的洞）
cyl('tree-cave', 0.26, 0.26, 0.26, 20, C.pink, TX + 0.02, 0.25, TZ + 0.02, tree);
cyl('tree-cave-in', 0.19, 0.19, 0.1, 20, 0x7d5f4c, TX + 0.02, 0.3, TZ + 0.02, tree);
// 吊球
cyl('tree-rope', 0.01, 0.01, 0.5, 6, C.brown, TX + 0.2, 1.05, TZ - 0.2, tree);
ball('tree-ball', 0.07, C.pinkDeep, TX + 0.2, 0.78, TZ - 0.2, tree);
tree.scale.setScalar(1.28);
tree.position.set(-TX * 0.28, 0, -TZ * 0.28);

/* ---------------- 床边壁架 ---------------- */
const wallShelf = group('wall-shelf');
box('ws-board', 1.5, 0.06, 0.26, C.wood, 2.5, 1.98, -2.9, wallShelf);
box('ws-bracket-l', 0.05, 0.2, 0.2, C.woodDeep, 1.9, 1.86, -2.9, wallShelf);
box('ws-bracket-r', 0.05, 0.2, 0.2, C.woodDeep, 3.1, 1.86, -2.9, wallShelf);
for (let i = 0; i < 5; i++) {
  box('ws-book', 0.07, 0.24, 0.18, C.book[(i + 2) % C.book.length], 1.85 + i * 0.075, 2.13, -2.9, wallShelf);
}
cyl('ws-pot', 0.08, 0.065, 0.14, 12, C.pot, 3.3, 2.08, -2.9, wallShelf);
ball('ws-leaf-1', 0.11, C.leaf, 3.3, 2.24, -2.9, wallShelf);
ball('ws-leaf-2', 0.08, C.leafDeep, 3.38, 2.18, -2.86, wallShelf);

/* ---------------- 小房子猫窝（右前） ---------------- */
const house = group('cat-house');
const HX = 3.25, HZ = 0.95;
box('ch-body', 0.86, 0.6, 0.78, C.cream, HX, 0.3, HZ, house);
box('ch-base', 0.92, 0.08, 0.84, C.wood, HX, 0.04, HZ, house);
const roof = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.34, 4), M(C.green));
roof.name = 'ch-roof';
roof.position.set(HX, 0.75, HZ);
roof.rotation.y = Math.PI / 4;
roof.castShadow = true;
house.add(roof);
box('ch-door', 0.34, 0.4, 0.02, 0x8a6b52, HX, 0.24, HZ + 0.4, house);
box('ch-pad', 0.5, 0.05, 0.4, C.quilt, HX, 0.06, HZ + 0.62, house);
cyl('ch-bowl', 0.11, 0.09, 0.07, 16, 0xc9d8f0, HX - 0.62, 0.04, HZ + 0.3, house);
house.scale.setScalar(1.12);
house.position.set(-HX * 0.12, 0, -HZ * 0.12);

/* ---------------- 圆桌 ---------------- */
const table = group('table');
const TBX = 1.5, TBZ = 1.5;
cyl('table-top', 0.44, 0.44, 0.06, 24, C.wood, TBX, 0.42, TBZ, table);
cyl('table-leg', 0.05, 0.06, 0.4, 12, C.woodDeep, TBX, 0.2, TBZ, table);
cyl('table-foot', 0.2, 0.2, 0.04, 16, C.woodDeep, TBX, 0.02, TBZ, table);
// 杯子与书
cyl('cup', 0.06, 0.05, 0.1, 14, 0xfffdf8, TBX + 0.16, 0.5, TBZ - 0.1, table);
box('table-book', 0.22, 0.04, 0.16, 0xa9c8f3, TBX - 0.12, 0.47, TBZ + 0.12, table);

/* ---------------- 圆地毯 ---------------- */
const rug = group('rug');
cyl('rug-base', 1.38, 1.38, 0.02, 40, 0xfffbf4, 0, 0.011, 0.62, rug, 1);
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2;
  const px = Math.cos(a) * 0.95, pz = 0.55 + Math.sin(a) * 0.95;
  cyl('rug-flower', 0.2, 0.2, 0.012, 14, C.green, px, 0.024, pz, rug, 1);
  cyl('rug-flower-core', 0.09, 0.09, 0.014, 12, 0xfff5c8, px, 0.027, pz, rug, 1);
}
cyl('rug-center', 0.34, 0.34, 0.012, 20, 0xdcefdb, 0, 0.025, 0.55, rug, 1);

/* ---------------- 软窝（左前） ---------------- */
const basket = group('bed-basket');
const KX = -2.35, KZ = 1.85;
cyl('basket-base', 0.5, 0.5, 0.16, 26, C.pink, KX, 0.08, KZ, basket);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.13, 10, 26), M(C.pink));
ring.name = 'basket-ring';
ring.rotation.x = Math.PI / 2;
ring.position.set(KX, 0.16, KZ);
ring.castShadow = true;
basket.add(ring);
cyl('basket-cushion', 0.38, 0.38, 0.06, 22, 0xfff8ee, KX, 0.14, KZ, basket, 1);

/* ---------------- 植物 ---------------- */
function plant(name, x, z, scale) {
  const g = group(name);
  cyl('pot-body', 0.16 * scale, 0.13 * scale, 0.28 * scale, 14, C.pot, x, 0.14 * scale, z, g);
  cyl('pot-rim', 0.17 * scale, 0.16 * scale, 0.05 * scale, 14, C.potDeep, x, 0.28 * scale, z, g);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ball('leaf', 0.16 * scale, i % 2 ? C.leaf : C.leafDeep,
      x + Math.cos(a) * 0.13 * scale, (0.42 + (i % 3) * 0.07) * scale, z + Math.sin(a) * 0.13 * scale, g);
  }
  return g;
}
plant('plant-1', -3.55, 0.35, 1.0);
plant('plant-2', -1.35, -2.78, 0.72);
plant('plant-3', 3.6, -1.2, 0.9);

/* ---------------- 玩具球 ---------------- */
const ballToy = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), M(C.pinkDeep, 0.7));
ballToy.name = 'toy-ball';
ballToy.position.set(0.35, 0.1, 2.15);
ballToy.castShadow = true;
root.add(ballToy);

/* ---------------- 墙饰 ---------------- */
const decor = group('decor');
box('picture-1', 0.34, 0.44, 0.03, C.woodDeep, 0.35, 1.85, -2.98, decor);
box('picture-1-in', 0.28, 0.36, 0.02, 0xfff4dc, 0.35, 1.85, -2.96, decor);
box('picture-2', 0.3, 0.3, 0.03, C.woodDeep, 1.05, 1.95, -2.98, decor);
box('picture-2-in', 0.24, 0.24, 0.02, 0xdcefdb, 1.05, 1.95, -2.96, decor);
ball('wall-star-1', 0.09, 0xfff0c0, -1.55, 2.2, -2.96, decor, 6);
ball('wall-star-2', 0.07, 0xfff0c0, 3.7, 2.3, -2.96, decor, 6);

/* ---------------- 导出 ---------------- */
const exporter = new GLTFExporter();
exporter.parse(
  root,
  (gltf) => {
    const json = JSON.stringify(gltf);
    fs.writeFileSync(OUT, json);
    // 同时产出一份可直接 <script> 引入的版本，file:// 下也能加载（避免 fetch 本地文件被拦）
    fs.writeFileSync(OUT.replace(/room\.gltf$/, 'room.data.js'), 'window.ROOM_GLTF = ' + json + ';\n');
    const nodes = (gltf.nodes || []).length;
    const meshes = (gltf.meshes || []).length;
    console.log('OK ->', OUT);
    console.log('nodes:', nodes, 'meshes:', meshes, 'size:', (json.length / 1024).toFixed(1) + 'KB');
  },
  (err) => {
    console.error('export failed', err);
    process.exit(1);
  },
  { binary: false, onlyVisible: true, trs: false }
);
