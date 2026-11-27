/* 网格导航 + A* 寻路
 * 房间固定 8×6 米，格子 0.2 米 → 40×30。
 * 障碍来自家具的世界包围盒，向外膨胀一点，宠物才不会贴着穿模。
 */
export class NavGrid {
  constructor(minX, maxX, minZ, maxZ, cell) {
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.cell = cell || 0.2;
    this.w = Math.ceil((maxX - minX) / this.cell);
    this.h = Math.ceil((maxZ - minZ) / this.cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }

  idx(ix, iz) { return iz * this.w + ix; }

  inside(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h;
  }

  isWalkable(ix, iz) {
    return this.inside(ix, iz) && this.blocked[this.idx(ix, iz)] === 0;
  }

  /** 用世界坐标的矩形列表标记障碍（含 pad 膨胀） */
  build(rects, pad) {
    const p = pad === undefined ? 0.1 : pad;
    this.blocked.fill(0);
    for (const r of rects) {
      const x0 = r.minX - p, x1 = r.maxX + p;
      const z0 = r.minZ - p, z1 = r.maxZ + p;
      const i0 = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
      const i1 = Math.min(this.w - 1, Math.floor((x1 - this.minX) / this.cell));
      const j0 = Math.max(0, Math.floor((z0 - this.minZ) / this.cell));
      const j1 = Math.min(this.h - 1, Math.floor((z1 - this.minZ) / this.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) this.blocked[this.idx(i, j)] = 1;
      }
    }
  }

  worldToCell(x, z) {
    return {
      ix: Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / this.cell))),
      iz: Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / this.cell)))
    };
  }

  cellToWorld(ix, iz) {
    return {
      x: this.minX + (ix + 0.5) * this.cell,
      z: this.minZ + (iz + 0.5) * this.cell
    };
  }

  walkableAtWorld(x, z) {
    const c = this.worldToCell(x, z);
    return this.isWalkable(c.ix, c.iz);
  }

  /** 找最近的可走格（点击落在家具上时用） */
  nearestWalkable(x, z, maxR) {
    const c = this.worldToCell(x, z);
    if (this.isWalkable(c.ix, c.iz)) return c;
    const R = maxR || 10;
    for (let r = 1; r <= R; r++) {
      let best = null, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const ix = c.ix + dx, iz = c.iz + dz;
          if (!this.isWalkable(ix, iz)) continue;
          const p = this.cellToWorld(ix, iz);
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d < bestD) { bestD = d; best = { ix, iz }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** A*（8 方向，不切角） */
  findPath(startX, startZ, goalX, goalZ) {
    const s = this.nearestWalkable(startX, startZ, 6);
    const g = this.nearestWalkable(goalX, goalZ, 12);
    if (!s || !g) return null;
    if (s.ix === g.ix && s.iz === g.iz) {
      const p = this.cellToWorld(g.ix, g.iz);
      return [p];
    }

    const W = this.w, H = this.h;
    const N = W * H;
    const gScore = new Float32Array(N).fill(Infinity);
    const fScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = [];

    const si = this.idx(s.ix, s.iz);
    const gi = this.idx(g.ix, g.iz);
    const heur = (ix, iz) => {
      const dx = Math.abs(ix - g.ix), dz = Math.abs(iz - g.iz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    gScore[si] = 0;
    fScore[si] = heur(s.ix, s.iz);
    open.push(si);

    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
    ];

    let guard = 0;
    while (open.length && guard++ < 20000) {
      // 取 f 最小（格子少，线性扫足够）
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === gi) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur - cx) / W;

      for (const [dx, dz, cost] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isWalkable(nx, nz)) continue;
        if (dx && dz) {
          // 不切角
          if (!this.isWalkable(cx + dx, cz) || !this.isWalkable(cx, cz + dz)) continue;
        }
        const ni = this.idx(nx, nz);
        if (closed[ni]) continue;
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) {
          came[ni] = cur;
          gScore[ni] = ng;
          fScore[ni] = ng + heur(nx, nz);
          open.push(ni);
        }
      }
    }

    if (came[gi] === -1 && gi !== si) return null;

    const cells = [];
    let cur = gi;
    let hops = 0;
    while (cur !== -1 && hops++ < 5000) {
      const ix = cur % W, iz = (cur - ix) / W;
      cells.push(this.cellToWorld(ix, iz));
      if (cur === si) break;
      cur = came[cur];
    }
    cells.reverse();
    return this.smooth(cells);
  }

  /** 视线可达就跳过中间点，路径更直 */
  smooth(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      for (; j > i + 1; j--) {
        if (this.lineClear(points[i], points[j])) break;
      }
      out.push(points[j]);
      i = j;
    }
    return out;
  }

  lineClear(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(dist / (this.cell * 0.5)));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const c = this.worldToCell(x, z);
      if (!this.isWalkable(c.ix, c.iz)) return false;
    }
    return true;
  }

  /** 随机取一个可走点（自主散步用） */
  randomPoint(rng) {
    for (let k = 0; k < 200; k++) {
      const ix = Math.floor((rng ? rng() : Math.random()) * this.w);
      const iz = Math.floor((rng ? rng() : Math.random()) * this.h);
      if (this.isWalkable(ix, iz)) return this.cellToWorld(ix, iz);
    }
    return null;
  }
}
