/* 场景装配：加载 room.gltf（独立几何体，不是背景图），
 * 收集家具包围盒做碰撞，登记可互动家具。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ROOM_BOUNDS = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };

// 参与碰撞的节点（其余是装饰）
const COLLIDERS = [
  'bed', 'bookshelf', 'nightstand', 'cat-tree', 'cat-house',
  'table', 'bed-basket', 'plant-1', 'plant-2', 'plant-3', 'wall-shelf'
];

// 可互动家具：走到 anchor 再触发 action
export const INTERACTIVES = {
  bed: {
    label: '睡觉', icon: '🛏️', anchor: [1.95, -0.78], action: 'sleep',
    line: '被子好软…我睡一小会儿，你别走太远。'
  },
  'cat-tree': {
    label: '爬猫爬架', icon: '🐈', anchor: [-2.95, -1.02], action: 'climb',
    line: '看我的！我能爬到最高那一层。'
  },
  'cat-house': {
    label: '钻小屋', icon: '🏠', anchor: [3.2, 2.02], action: 'rest',
    line: '这是我家，进来要弯腰哦。'
  },
  'bed-basket': {
    label: '躺软窝', icon: '🧺', anchor: [-2.35, 1.22], action: 'rest',
    line: '这个窝刚好把我装下。'
  },
  table: {
    label: '坐一会儿', icon: '☕', anchor: [1.5, 2.22], action: 'sit',
    line: '桌上有一杯温水，是给我留的吧。'
  },
  bookshelf: {
    label: '看书', icon: '📚', anchor: [-0.5, -2.28], action: 'read',
    line: '这本讲的是星星掉进海里…'
  },
  'toy-ball': {
    label: '玩球', icon: '🎾', anchor: [0.78, 2.15], action: 'play',
    line: '球球！我追！'
  },
  window: {
    label: '看窗外', icon: '🪟', anchor: [-2.05, -2.02], action: 'watch',
    line: '外面在飘花瓣，风是暖的。'
  }
};

export function loadRoom(scene, onProgress) {
  return new Promise((resolve, reject) => {
    const json = window.ROOM_GLTF;
    if (!json) {
      reject(new Error('缺少 assets/room.data.js'));
      return;
    }
    // 用 parse 而不是 load：file:// 下 fetch 本地 .gltf 会被浏览器拦
    new GLTFLoader().parse(
      json,
      './assets/',
      (gltf) => {
        const root = gltf.scene;
        root.name = 'ROOM';
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material.side = THREE.FrontSide;
              o.material.envMapIntensity = 0.5;
            }
          }
        });
        scene.add(root);

        // 窗外景（天空/云/樱花）不受光，夜里才不会变成一团黑
        root.traverse((o) => {
          if (!o.isMesh) return;
          const n = o.name || '';
          if (/^(sky|cloud|sakura)/.test(n)) {
            const c = o.material.color.clone();
            o.material = new THREE.MeshBasicMaterial({ color: c });
          }
        });

        // 节点索引
        const byName = new Map();
        root.traverse((o) => {
          if (o.name && !byName.has(o.name)) byName.set(o.name, o);
        });

        // 碰撞盒
        const boxes = [];
        for (const name of COLLIDERS) {
          const node = byName.get(name);
          if (!node) continue;
          const b = new THREE.Box3().setFromObject(node);
          boxes.push({ name, minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
        }

        // 可点击物体：把每个互动节点的 mesh 收进列表，挂上 key
        const hitList = [];
        for (const key of Object.keys(INTERACTIVES)) {
          const node = byName.get(key);
          if (!node) continue;
          node.traverse((o) => {
            if (o.isMesh) {
              o.userData.interact = key;
              hitList.push(o);
            }
          });
        }
        // 窗户：窗洞是墙板围出来的，补一块透明点击板
        const win = byName.get('window');
        if (win) {
          const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(2.5, 1.55),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          panel.position.set(-2.05, 1.62, -2.97);
          panel.userData.interact = 'window';
          root.add(panel);
          hitList.push(panel);
        }

        // 球单独引用（玩球时会滚）
        const ball = byName.get('toy-ball');

        resolve({
          root,
          byName,
          boxes,
          hitList,
          ball,
          night: {
            sky: byName.get('sky'),
            stars: [byName.get('ns-lamp-star'), byName.get('star-light')]
          }
        });
        onProgress && onProgress(1);
      },
      (err) => reject(err)
    );
  });
}
