/* 宠物：3D 房间里的立牌式角色
 * - 平面始终面向相机（billboard），按「相对相机的朝向」切 5 张转身图 + 镜像补出 8 向
 * - 会沿路径走、会坐下/趴下/跳、会爬猫爬架
 */
import * as THREE from 'three';

const VIEW_STEP = Math.PI / 4;

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(74,54,38,0.55)');
  grd.addColorStop(0.45, 'rgba(74,54,38,0.24)');
  grd.addColorStop(1, 'rgba(74,54,38,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pet {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'pet';
    scene.add(this.group);

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({
        transparent: true, alphaTest: 0.02, depthWrite: true, toneMapped: false, side: THREE.DoubleSide
      })
    );
    this.mesh.position.y = 0.55;
    this.mesh.name = 'pet-plane';
    this.group.add(this.mesh);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.42, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.006;
    this.group.add(this.shadow);

    this.pos = new THREE.Vector2(0, 1.9);
    this.facing = Math.PI;          // 面朝房间深处
    this.targetFacing = Math.PI;
    this.path = null;
    this.pathIdx = 0;
    this.onArrive = null;
    this.speed = 1.25;
    this.state = 'idle';
    this.stateT = 0;
    this.baseY = 0;
    this.hop = 0;
    this.time = 0;
    this.textures = [];
    this.viewIdx = -1;
    this.mirror = false;
    this.lockInput = false;

    this.group.position.set(this.pos.x, 0, this.pos.y);
  }

  setPet(data) {
    this.data = data;
    const loader = new THREE.TextureLoader();
    const list = (data.views && data.views.length ? data.views : [data.texture]);
    this.textures = list.map((uri) => {
      const t = loader.load(uri);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    });
    this.viewIdx = -1;
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.y; }

  setPosition(x, z) {
    this.pos.set(x, z);
    this.group.position.set(x, 0, z);
  }

  walkTo(points, onArrive) {
    if (!points || !points.length) {
      if (onArrive) onArrive();
      return;
    }
    this.path = points;
    this.pathIdx = 0;
    this.onArrive = onArrive || null;
    this.state = 'walk';
    this.stateT = 0;
  }

  stop() {
    this.path = null;
    this.onArrive = null;
    if (this.state === 'walk') this.state = 'idle';
  }

  isWalking() {
    return this.state === 'walk' && !!this.path;
  }

  setState(s, dur) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur || 0;
  }

  faceTo(x, z) {
    this.targetFacing = Math.atan2(x - this.pos.x, z - this.pos.y);
  }

  /** 相机方位角（平面朝相机） */
  update(dt, camYaw) {
    this.time += dt;
    this.stateT += dt;

    // --- 移动 ---
    if (this.path && this.pathIdx < this.path.length && this.state === 'walk') {
      const tgt = this.path[this.pathIdx];
      const dx = tgt.x - this.pos.x;
      const dz = tgt.z - this.pos.y;
      const d = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (d <= step || d < 0.04) {
        this.pos.set(tgt.x, tgt.z);
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          this.path = null;
          this.state = 'idle';
          const cb = this.onArrive;
          this.onArrive = null;
          if (cb) cb();
        }
      } else {
        const nx = dx / d, nz = dz / d;
        this.pos.x += nx * step;
        this.pos.y += nz * step;
        this.targetFacing = Math.atan2(nx, nz);
      }
    }

    // --- 朝向平滑 ---
    this.facing = lerpAngle(this.facing, this.targetFacing, dt * 12);

    // --- 高度 / 形变 ---
    let y = 0;
    let sy = 1, sx = 1;
    let shadowK = 1;

    if (this.state === 'walk') {
      y = Math.abs(Math.sin(this.time * 9)) * 0.022;
      this.hop = 0;
    } else if (this.state === 'sleep' || this.state === 'rest') {
      y = -0.055;
      sy = 0.72; sx = 1.08;
    } else if (this.state === 'sit' || this.state === 'read' || this.state === 'watch') {
      y = -0.02;
      sy = 0.92; sx = 1.04;
    } else if (this.state === 'play') {
      y = Math.abs(Math.sin(this.time * 6.5)) * 0.26;
      shadowK = 1 + y * 0.9;
    } else if (this.state === 'climb') {
      y = this.climbY || 0;
      shadowK = 1 + y * 0.8;
      sy = 0.96; sx = 1.0;
    } else {
      // idle：呼吸
      y = Math.sin(this.time * 2.1) * 0.006;
    }

    this.baseY = y;
    this.group.position.set(this.pos.x, y, this.pos.y);
    this.mesh.scale.set(sx * (this.mirror ? -1 : 1), sy, 1);
    this.mesh.position.y = 0.55 * sy;

    // 影子随高度变大变淡
    const s = 1 + Math.max(0, y) * 1.6;
    this.shadow.scale.set(s, s, 1);
    this.shadow.position.y = 0.006;
    this.shadow.material.opacity = 0.42 / (1 + Math.max(0, y) * 3.2);

    // --- billboard + 转身图 ---
    this.group.rotation.y = camYaw;
    this.pickView(camYaw);
  }

  pickView(camYaw) {
    if (!this.textures.length) return;
    // 相对相机：0 = 正对相机，PI = 背对
    let rel = Math.PI - (this.facing - camYaw);
    rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let idx = Math.round(rel / VIEW_STEP) % 8;
    if (idx < 0) idx += 8;

    let v, mirror;
    if (idx <= 4) { v = idx; mirror = false; }
    else { v = 8 - idx; mirror = true; }
    v = Math.min(v, this.textures.length - 1);

    if (v !== this.viewIdx) {
      this.viewIdx = v;
      this.mesh.material.map = this.textures[v];
      this.mesh.material.needsUpdate = true;
    }
    if (mirror !== this.mirror) {
      this.mirror = mirror;   // 下一帧 update 里带上符号
    }
  }

  /** 爬猫爬架：把 y 补间到平台高度 */
  climbTo(targetY, duration, done) {
    this.setState('climb');
    const y0 = this.baseY;
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / (duration * 1000));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.climbY = y0 + (targetY - y0) * e;
      if (k < 1) requestAnimationFrame(tick);
      else if (done) done();
    };
    tick();
  }
}
