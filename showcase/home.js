/* 星宠语 · 宠物小屋
 * 结构：
 *   SCR / PALETTES   五个场景的程序化 SVG（白天 / 夜晚两套配色）
 *   state            当前宠物 / 场景 / 时段 / 挂件 / 三项状态（localStorage 记忆）
 *   交互             场景切换、换伙伴、聊天、穿搭、喂食、图鉴、去展厅
 */
(function () {
  'use strict';

  var DATA = window.PET_DATA || [];
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  if (!DATA.length) {
    document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;inset:0;display:grid;place-items:center;font-size:14px;color:#a1968a">没有找到宠物数据，请确认 data/pets.js 是否存在</div>');
    return;
  }

  /* ---------------- 状态 ---------------- */
  var SAVE_KEY = 'xingchongyu.house.v2';
  var state = {
    idx: 0, scene: 'flower', night: false, charm: 0,
    full: 68, mood: 82, bond: 45, streak: 1
  };
  try {
    var raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (var k in state) if (k in raw) state[k] = raw[k];
    }
  } catch (e) { /* 忽略 */ }
  state.idx = Math.max(0, Math.min(DATA.length - 1, state.idx | 0));
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {} }

  function pet() { return DATA[state.idx]; }

  /* ---------------- 工具 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var uidSeq = 0;

  /* ---------------- 场景素材 ----------------
   * 全部程序化 SVG（800×560），任意放大都清晰；白天 / 夜晚只换调色板。
   * 分层：天空 → 远景 → 中景 → 地面 → 角色受光 → 前景虚化 → 暗角。
   * 角色脚底固定在 (400, 487) 附近，所以中下部保持干净，细节都往两侧和上方放。
   * thumb=true 时装饰数量减半，八张缩略图同屏也不卡。
   */
  function stopS(off, color, op) {
    return '<stop offset="' + off + '" stop-color="' + color + '"' +
      (op == null ? '' : ' stop-opacity="' + op + '"') + '/>';
  }
  function lg(id, stops, x1, y1, x2, y2) {
    var s = '';
    for (var i = 0; i < stops.length; i++) s += stopS(stops[i][0], stops[i][1], stops[i][2]);
    return '<linearGradient id="' + id + '" x1="' + (x1 == null ? 0 : x1) + '" y1="' + (y1 == null ? 0 : y1) +
      '" x2="' + (x2 == null ? 0 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' + s + '</linearGradient>';
  }
  function rg(id, stops, cx, cy, r) {
    var s = '';
    for (var i = 0; i < stops.length; i++) s += stopS(stops[i][0], stops[i][1], stops[i][2]);
    return '<radialGradient id="' + id + '" cx="' + (cx == null ? 0.5 : cx) + '" cy="' + (cy == null ? 0.5 : cy) +
      '" r="' + (r == null ? 0.6 : r) + '">' + s + '</radialGradient>';
  }
  function blurDef(id, sd) {
    return '<filter id="' + id + '" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="' + sd + '"/></filter>';
  }
  // 角色脚下的柔光，把主体从背景里托出来
  function seatLight(uid) {
    return '<ellipse cx="400" cy="478" rx="250" ry="122" fill="url(#' + uid + '_seat)"/>';
  }
  function seatDef(uid, color, op) {
    return rg(uid + '_seat', [[0, color, op], [0.62, color, op * 0.35], [1, color, 0]], 0.5, 0.5, 0.5);
  }
  function vignetteDef(uid, color, op) {
    return rg(uid + '_vg', [[0.52, color, 0], [0.8, color, op * 0.4], [1, color, op]]);
  }
  function vignetteRect(uid) {
    return '<rect width="800" height="560" fill="url(#' + uid + '_vg)"/>';
  }
  function cloudBlob(x, y, k, fill, op) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')" fill="' + fill + '" opacity="' + op + '">' +
      '<ellipse rx="64" ry="23"/><ellipse cx="-48" cy="9" rx="38" ry="16"/>' +
      '<ellipse cx="50" cy="8" rx="42" ry="17"/><ellipse cx="-6" cy="-16" rx="36" ry="21"/>' +
      '<ellipse cx="30" cy="-9" rx="26" ry="16"/></g>';
  }
  function starsN(rnd, n, color, maxY) {
    var o = '';
    for (var i = 0; i < n; i++) {
      var r = 0.6 + rnd() * 1.6;
      o += '<circle cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (rnd() * maxY).toFixed(1) +
        '" r="' + r.toFixed(2) + '" fill="' + color + '" opacity="' + (0.3 + rnd() * 0.65).toFixed(2) + '"/>';
    }
    return o;
  }
  // 萤火 / 灯火：外圈光晕 + 亮芯
  function fireflies(rnd, n, y0, y1, color, opacity) {
    var o = '';
    for (var i = 0; i < n; i++) {
      var x = rnd() * 800, y = y0 + rnd() * (y1 - y0), r = 1.1 + rnd() * 1.6;
      o += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r * 3.4).toFixed(1) +
        '" fill="' + color + '" opacity="' + ((opacity || 0.2) * 0.5).toFixed(2) + '"/>';
      o += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + color + '" opacity="' + ((opacity || 0.2) + 0.35).toFixed(2) + '"/>';
    }
    return o;
  }
  // 散景：大而淡的圆，模拟镜头虚化，比画实心花更耐看
  function bokehN(rnd, n, y0, y1, colors, rMin, rMax, op) {
    var o = '';
    for (var i = 0; i < n; i++) {
      o += '<circle cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (y0 + rnd() * (y1 - y0)).toFixed(1) +
        '" r="' + (rMin + rnd() * (rMax - rMin)).toFixed(1) + '" fill="' +
        colors[(rnd() * colors.length) | 0] + '" opacity="' + (0.04 + rnd() * op).toFixed(2) + '"/>';
    }
    return o;
  }
  function sparkle(cx, cy, r, color, op) {
    var q = r * 0.18;
    return '<path d="M' + cx + ' ' + (cy - r) + ' Q' + (cx + q) + ' ' + (cy - q) + ' ' + (cx + r) + ' ' + cy +
      ' Q' + (cx + q) + ' ' + (cy + q) + ' ' + cx + ' ' + (cy + r) +
      ' Q' + (cx - q) + ' ' + (cy + q) + ' ' + (cx - r) + ' ' + cy +
      ' Q' + (cx - q) + ' ' + (cy - q) + ' ' + cx + ' ' + (cy - r) + 'Z" fill="' + color + '" opacity="' + op + '"/>';
  }
  function butterfly(x, y, k, color, op) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')" fill="' + color + '" opacity="' + op + '">' +
      '<path d="M0 0 q-10 -11 -15 -1 q-4 9 7 8 q9 -1 8 -7Z"/>' +
      '<path d="M0 0 q10 -11 15 -1 q4 9 -7 8 q-9 -1 -8 -7Z"/>' +
      '<path d="M0 -1 q1 4 0 7" stroke="' + color + '" stroke-width="1.4" fill="none"/></g>';
  }
  // 五瓣小花：比一个圆点更像花，尺寸小也不糊
  function bloomGlyph(cx, cy, r, color, core, op, slim) {
    var o = '', pr = r * (slim ? 0.4 : 0.52), pd = r * (slim ? 0.72 : 0.6);
    for (var i = 0; i < 5; i++) {
      var a = (i * 72 + 18) * Math.PI / 180;
      o += '<circle cx="' + (cx + Math.cos(a) * pd).toFixed(1) + '" cy="' + (cy + Math.sin(a) * pd).toFixed(1) +
        '" r="' + pr.toFixed(1) + '" fill="' + color + '" opacity="' + op + '"/>';
    }
    return o + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * (slim ? 0.28 : 0.36)).toFixed(1) + '" fill="' + core + '" opacity="' + op + '"/>';
  }
  function petals(rnd, n, maxY) {
    var o = '';
    for (var i = 0; i < n; i++) {
      var x = rnd() * 800, y = 60 + rnd() * maxY, r = 2.4 + rnd() * 3.4, a = rnd() * 180;
      o += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="' + r.toFixed(1) +
        '" ry="' + (r * 0.62).toFixed(1) + '" fill="#ffd3e0" opacity="' + (0.35 + rnd() * 0.45).toFixed(2) +
        '" transform="rotate(' + a.toFixed(0) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>';
    }
    return o;
  }
  function grassTuft(x, baseY, h, color, op) {
    return '<path d="M' + x + ' ' + baseY + ' q-6 -' + h + ' -10 -' + (h * 1.35) +
      ' M' + x + ' ' + baseY + ' q1 -' + (h * 1.1) + ' 2 -' + (h * 1.5) +
      ' M' + x + ' ' + baseY + ' q7 -' + h + ' 12 -' + (h * 1.2) +
      '" stroke="' + color + '" stroke-width="2" fill="none" stroke-linecap="round" opacity="' + op + '"/>';
  }

  var PALETTES = {
    flower: {
      day: {
        sky: ['#2eb4f2', '#6fd3ff', '#c6efff', '#fff0cf'], sun: '#fff7cf', cloud: '#ffffff',
        hillFar: '#b9ddf4', hillMid: '#9fd9ac', hillNear: '#74c584', ground: '#5cb96c',
        bloom: ['#ff7fa6', '#ffc94d', '#9b7bf7', '#4fd6b4', '#ff8f5a', '#fff0f6', '#ff5f8f']
      },
      night: {
        sky: ['#0a1230', '#172552', '#2b3a68', '#463a63'], sun: '#fff6d6', cloud: '#5d6f9c',
        hillFar: '#1b2a4a', hillMid: '#173a44', hillNear: '#133a3a', ground: '#12312f',
        bloom: ['#ffb3c8', '#ffe0a0', '#c3b4ff', '#8fe6d0']
      }
    },
    desk: {
      day: {
        wall: ['#fdf1e1', '#f6dcc0'], wood: ['#e2b184', '#b9895c'], sky: ['#bfeaff', '#f4fbff'],
        cloud: '#ffffff', accent: '#ffd7a3', leaf: '#86c47f', frame: '#f0d6b6'
      },
      night: {
        wall: ['#4e3d4c', '#33283a'], wood: ['#7a5740', '#4d3526'], sky: ['#0e1b3c', '#23345e'],
        cloud: '#5a6d96', accent: '#ffcf8a', leaf: '#3d6350', frame: '#7a5c43'
      }
    },
    bedroom: {
      day: {
        wall: ['#ffe0c3', '#f8c69f'], wallLow: '#eeb489', floor: ['#d49a6a', '#ab754c'],
        bed: '#ffb3c4', bed2: '#ff8fa8', pillow: '#fff3ea', head: '#ffd9c2', wood: '#b07a4e',
        accent: '#fffaf2', light: '#ffe9b8', curtain: '#ffe3d3', throw: '#ffb877', leaf: '#7fbf8c'
      },
      night: {
        wall: ['#3b3049', '#2b2338'], wallLow: '#241d31', floor: ['#3d2e35', '#241a21'],
        bed: '#7d5364', bed2: '#9a6480', pillow: '#6f5a68', head: '#4c3a4c', wood: '#4a3230',
        accent: '#ffe3bd', light: '#ffc98a', curtain: '#5a4152', throw: '#8a6a4a', leaf: '#3d6350'
      }
    },
    sakura: {
      day: {
        sky: ['#ffd6e5', '#ffeef3', '#fffaf0', '#eef9e9'], blossom: ['#ffaac6', '#ffc4d7', '#ffdce6'],
        trunk: '#8a6350', grass: ['#b8dda0', '#98cd86'], hill: '#cde7bb', water: '#bfe6ef', sun: '#fff6e4'
      },
      night: {
        sky: ['#191634', '#252143', '#322d52'], blossom: ['#8f6383', '#a8789a', '#c08fae'],
        trunk: '#442f2c', grass: ['#20343e', '#1a2a33'], hill: '#243846', water: '#1b3348', sun: '#fff8e0'
      }
    },
    moon: {
      day: {
        sky: ['#ffd2ab', '#f7a9ad', '#b98fb4', '#7d76a8'], moon: '#fff4d2', castle: '#6b567c',
        ground: '#4a3f5c', lake: ['#9a89b2', '#5b4d75'], star: '#fff3d8'
      },
      night: {
        sky: ['#070d22', '#0d1734', '#16224a', '#232b52'], moon: '#fffbe8', castle: '#2a3352',
        ground: '#111a2e', lake: ['#1b2a48', '#0a1324'], star: '#ffffff'
      }
    },
    beach: {
      day: {
        sky: ['#63caff', '#b6e9ff', '#fff1cf'], sun: '#fff7cf', sea: ['#3fd2dc', '#1fb9cc', '#0f97b2'],
        sand: ['#ffe1b0', '#f0c391'], palm: '#2b7a64', parasol: ['#ff8268', '#fff6ee']
      },
      night: {
        sky: ['#08132e', '#132447', '#33406b'], sun: '#fff8dd', sea: ['#123a52', '#0d2a40', '#081d2e'],
        sand: ['#454c66', '#31374c'], palm: '#1c3b46', parasol: ['#9c6670', '#544c60']
      }
    },
    forest: {
      day: {
        sky: ['#c9e8b4', '#eef7cf'], canopy: '#2a6b50', far: '#6aa383', mid: '#40795c',
        near: '#2b5f49', ground: ['#9ec97c', '#639c58'], light: '#fff4c6', water: '#8fd0c8'
      },
      night: {
        sky: ['#12323a', '#1c464a'], canopy: '#17463f', far: '#2c6353', mid: '#27594a',
        near: '#1e4a3e', ground: ['#3a7358', '#1e4433'], light: '#c8f8e0', water: '#2f6f68'
      }
    },
    rooftop: {
      day: {
        sky: ['#ffc09a', '#ff9fb0', '#b492d6', '#6d6aa6'], city: '#6a5a86', city2: '#4c4166',
        floor: ['#e0cdc4', '#bda9a6'], lights: '#ffe6a8', accent: '#ff9a76', sun: '#fff0c8'
      },
      night: {
        sky: ['#0b1030', '#1a1a45', '#33285e'], city: '#2b2f55', city2: '#1d2140',
        floor: ['#37334f', '#221f38'], lights: '#ffd98a', accent: '#9a80e0', sun: '#fff8e2'
      }
    }
  };

  /* 1. 花海晴空 */
  function sceneFlower(P, uid, night, thumb) {
    var rnd = mulberry32(7), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.38, P.sky[1]], [0.7, P.sky[2]], [1, P.sky[3]]]);
    d += rg(uid + '_sun', [[0, P.sun, 0.95], [0.3, P.sun, 0.36], [1, P.sun, 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_mw', [[0, '#b7a4ff', 0], [0.45, '#cbb8ff', 0.3], [0.62, '#9fd0ff', 0.22], [1, '#b7a4ff', 0]], 0.5, 0.5, 0.5);
    d += seatDef(uid, night ? '#a8d8ff' : '#fff8e0', night ? 0.2 : 0.3);
    d += lg(uid + '_hz', [[0, night ? '#9ec4ff' : '#ffffff', 0], [0.45, night ? '#9ec4ff' : '#ffffff', night ? 0.16 : 0.4], [1, night ? '#9ec4ff' : '#ffffff', 0]], 0, 0, 0, 1);
    d += rg(uid + '_warm', [[0, night ? '#ffe6b0' : '#fff0bc', night ? 0.22 : 0.5], [1, night ? '#ffe6b0' : '#fff0bc', 0]], 0.8, 0.3, 0.6);
    d += vignetteDef(uid, '#241a33', night ? 0.42 : 0.24);
    d += blurDef(uid + '_fg', 3.6);
    d += blurDef(uid + '_fg2', 1.0);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) {
      b += '<g transform="rotate(-16 400 210)" opacity=".8"><rect x="-40" y="150" width="880" height="120" fill="url(#' + uid + '_mw)"/></g>';
      b += starsN(rnd, Math.round(150 * q), '#ffffff', 360);
      b += '<circle cx="636" cy="112" r="190" fill="url(#' + uid + '_sun)"/>';
      b += '<circle cx="636" cy="112" r="44" fill="' + P.sun + '"/>';
      b += '<circle cx="620" cy="100" r="41" fill="' + P.sky[1] + '" opacity=".62"/>';
    } else {
      b += '<circle cx="636" cy="112" r="215" fill="url(#' + uid + '_sun)"/>';
      b += '<circle cx="636" cy="112" r="46" fill="' + P.sun + '"/>';
      b += '<circle cx="636" cy="112" r="64" fill="' + P.sun + '" opacity=".22"/>';
    }
    b += cloudBlob(146, 106, 1, P.cloud, night ? 0.32 : 0.92);
    b += cloudBlob(392, 72, 0.72, P.cloud, night ? 0.28 : 0.85);
    b += cloudBlob(706, 206, 0.54, P.cloud, night ? 0.22 : 0.72);
    b += cloudBlob(268, 196, 0.42, P.cloud, night ? 0.18 : 0.6);

    // 阳光扇面 + 飞鸟，让天空不空
    if (!night) {
      b += '<g fill="' + P.sun + '" opacity=".5">';
      for (var ry = 0; ry < 5; ry++) {
        b += '<path d="M626 118 L552 620 L596 620Z" transform="rotate(' + (-26 + ry * 13) + ' 632 116)" opacity="' + (0.16 - ry * 0.02).toFixed(2) + '"/>';
      }
      b += '</g>';
      b += '<g stroke="#5a4a6a" stroke-width="2" fill="none" stroke-linecap="round" opacity=".38">' +
        '<path d="M268 138 q9 -7 18 0 q9 -7 18 0"/>' +
        '<path d="M312 168 q7 -5 14 0 q7 -5 14 0"/>' +
        '<path d="M226 176 q6 -4 12 0 q6 -4 12 0"/></g>';
    }

    // 远山三层，越远越淡
    b += '<path d="M0 320 L96 266 L164 310 L246 248 L330 316 L426 274 L520 322 L618 280 L716 318 L800 294 L800 560 L0 560Z" fill="' +
      P.hillFar + '" opacity="' + (night ? 0.45 : 0.6) + '"/>';
    b += '<path d="M0 352 C112 314 232 344 352 364 C480 386 620 338 800 358 L800 560 L0 560Z" fill="' + P.hillMid + '"/>';
    b += '<path d="M0 414 C150 384 306 412 470 428 C612 442 714 412 800 422 L800 560 L0 560Z" fill="' + P.hillNear + '"/>';
    b += '<path d="M0 466 C176 446 340 466 504 474 C646 480 726 460 800 468 L800 560 L0 560Z" fill="' + P.ground + '"/>';
    // 山脊的软阴影 + 地平线雾气，让色块不再死平
    b += '<path d="M0 414 C150 384 306 412 470 428 C612 442 714 412 800 422" stroke="#3d7a4a" stroke-width="3" fill="none" opacity="' + (night ? 0.12 : 0.1) + '"/>';
    b += '<path d="M0 466 C176 446 340 466 504 474 C646 480 726 460 800 468" stroke="#2f6b3c" stroke-width="3" fill="none" opacity="' + (night ? 0.12 : 0.12) + '"/>';
    b += '<rect y="250" width="800" height="220" fill="url(#' + uid + '_hz)"/>';
    b += '<rect y="300" width="800" height="260" fill="url(#' + uid + '_warm)"/>';
    // 草叶纹理
    for (var gb = 0; gb < Math.round(60 * q); gb++) {
      var gx3 = rnd() * 800, gy3 = 460 + rnd() * 60;
      b += '<path d="M' + gx3.toFixed(1) + ' ' + gy3.toFixed(1) + ' q2 -6 4 -1" stroke="' + (night ? '#0d2a24' : '#4e9a5c') +
        '" stroke-width="1.6" fill="none" opacity=".28"/>';
    }

    // 花田：越靠近镜头越大，颜色从调色板里随机取
    var n1 = Math.round(200 * q);
    for (var i = 0; i < n1; i++) {
      var fx = rnd() * 800, fy = 446 + Math.pow(rnd(), 0.62) * 82;
      var r = 2.0 + rnd() * 4.2;
      var c = P.bloom[(rnd() * P.bloom.length) | 0];
      var op = (0.55 + rnd() * 0.45).toFixed(2);
      if (r > 3.1) {
        b += bloomGlyph(fx, fy, r, c, night ? '#fff0c4' : '#ffd166', op);
        b += '<path d="M' + fx.toFixed(1) + ' ' + (fy + r).toFixed(1) + ' q1 5 2 8" stroke="' +
          (night ? '#0d2a24' : '#4e9a5c') + '" stroke-width="1.6" fill="none" opacity=".35"/>';
      } else {
        b += '<circle cx="' + fx.toFixed(1) + '" cy="' + fy.toFixed(1) + '" r="' + r.toFixed(1) +
          '" fill="' + c + '" opacity="' + op + '"/>';
      }
    }
    // 中景花带：淡淡一层，拉开纵深
    for (var mf = 0; mf < Math.round(90 * q); mf++) {
      b += '<circle cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (424 + rnd() * 46).toFixed(1) + '" r="' +
        (1 + rnd() * 1.3).toFixed(1) + '" fill="' + P.bloom[(rnd() * P.bloom.length) | 0] + '" opacity="' + (0.28 + rnd() * 0.3).toFixed(2) + '"/>';
    }
    // 前景大花：压住画面两角，近实远虚
    b += '<g filter="url(#' + uid + '_fg2)" opacity=".95">' +
      bloomGlyph(46, 462, 26, '#ff8fb0', '#ffd166', 0.95, true) +
      bloomGlyph(252, 540, 30, '#ffd166', '#ff8f5a', 0.95, true) +
      bloomGlyph(578, 548, 25, '#b9a2ff', '#fff0c4', 0.95, true) +
      bloomGlyph(776, 466, 27, '#fff3f8', '#ffc94d', 0.95, true) + '</g>';
    for (var s = 0; s < (thumb ? 3 : 9); s++) {
      b += sparkle(60 + rnd() * 700, 110 + rnd() * 250, 2 + rnd() * 3, night ? '#dcd2ff' : '#ffffff', 0.45 + rnd() * 0.4);
    }
    for (var bf = 0; bf < (thumb ? 1 : 3); bf++) {
      b += butterfly(140 + rnd() * 520, 330 + rnd() * 110, 0.9 + rnd() * 0.5,
        night ? '#d8ccff' : '#fff0f5', 0.8);
    }
    if (night) b += fireflies(rnd, Math.round(20 * q), 380, 540, '#ffe9a0', 0.22);

    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity="' + (night ? 0.55 : 0.45) + '">' +
      grassTuft(18, 534, 44, P.ground, 0.9) + grassTuft(64, 534, 30, P.hillNear, 0.8) +
      grassTuft(772, 534, 42, P.ground, 0.9) + grassTuft(726, 534, 28, P.hillNear, 0.8) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 2. 云端书桌 */
  function sceneDesk(P, uid, night, thumb) {
    var rnd = mulberry32(21), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_wall', [[0, P.wall[0]], [1, P.wall[1]]], 0, 0, 0.25, 1);
    d += lg(uid + '_sky', [[0, P.sky[0]], [1, P.sky[1]]]);
    d += lg(uid + '_wood', [[0, P.wood[0]], [1, P.wood[1]]]);
    d += rg(uid + '_lamp', [[0, P.accent, 0.85], [0.45, P.accent, 0.25], [1, P.accent, 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_wash', [[0, '#fff6dd', night ? 0.26 : 0.5], [1, '#fff6dd', 0]], 0.5, 0.5, 0.5);
    d += seatDef(uid, night ? '#ffd9a0' : '#fff6e0', night ? 0.18 : 0.26);
    d += vignetteDef(uid, '#241a2e', night ? 0.36 : 0.24);
    d += blurDef(uid + '_fg', 3.2);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_wall)"/>';
    b += '<circle cx="620" cy="60" r="330" fill="url(#' + uid + '_wash)"/>';
    // 墙板缝
    for (var i = 0; i < 9; i++) {
      b += '<line x1="' + (i * 96 + 12) + '" y1="0" x2="' + (i * 96 + 12) + '" y2="384" stroke="rgba(120,86,56,.07)" stroke-width="1.6"/>';
    }

    // 窗：外面是一片云海
    b += '<rect x="432" y="40" width="316" height="246" rx="18" fill="' + P.frame + '"/>';
    b += '<rect x="448" y="56" width="284" height="214" rx="10" fill="url(#' + uid + '_sky)"/>';
    if (night) {
      b += starsN(rnd, Math.round(26 * q), '#ffffff', 200);
      b += '<circle cx="668" cy="104" r="22" fill="' + P.accent + '"/>';
      b += '<circle cx="660" cy="98" r="19" fill="' + P.sky[1] + '" opacity=".7"/>';
    } else {
      b += '<circle cx="668" cy="106" r="26" fill="#fff8dc" opacity=".9"/>';
    }
    b += cloudBlob(512, 214, 0.6, P.cloud, night ? 0.4 : 0.9);
    b += cloudBlob(614, 246, 0.84, P.cloud, night ? 0.42 : 0.95);
    b += cloudBlob(706, 226, 0.5, P.cloud, night ? 0.3 : 0.8);
    b += cloudBlob(560, 176, 0.4, P.cloud, night ? 0.22 : 0.65);
    b += '<line x1="590" y1="56" x2="590" y2="270" stroke="' + P.frame + '" stroke-width="8"/>';
    b += '<line x1="448" y1="164" x2="732" y2="164" stroke="' + P.frame + '" stroke-width="7"/>';
    b += '<rect x="424" y="276" width="332" height="14" rx="7" fill="' + P.frame + '"/>';
    b += '<rect x="424" y="276" width="332" height="5" rx="3" fill="#fff" opacity=".28"/>';

    // 窗上小串灯
    b += '<path d="M452 68 q70 30 140 8 t140 16" stroke="rgba(255,255,255,.4)" stroke-width="1.6" fill="none"/>';
    for (var L = 0; L < 7; L++) {
      var lx = 462 + L * 40, ly = 76 + Math.sin(L * 0.9) * 10;
      b += '<circle cx="' + lx + '" cy="' + ly + '" r="10" fill="' + P.accent + '" opacity="' + (night ? 0.28 : 0.12) + '"/>';
      b += '<circle cx="' + lx + '" cy="' + ly + '" r="3" fill="' + (night ? '#ffe3ad' : '#fff8e6') + '" opacity=".95"/>';
    }

    // 左墙小搁板
    b += '<rect x="52" y="196" width="156" height="10" rx="4" fill="' + P.wood[1] + '"/>';
    b += '<rect x="66" y="158" width="16" height="38" rx="3" fill="' + (night ? '#7a5a63' : '#f6a9b8') + '"/>';
    b += '<rect x="86" y="150" width="14" height="46" rx="3" fill="' + (night ? '#5a6a80' : '#9fc9e8') + '"/>';
    b += '<rect x="104" y="162" width="18" height="34" rx="3" fill="' + (night ? '#7d6a4f' : '#ffd8a0') + '"/>';
    b += '<path d="M142 196 q2 -22 12 -26 q10 6 8 26Z" fill="' + P.leaf + '"/>';
    b += '<rect x="138" y="182" width="26" height="16" rx="4" fill="' + (night ? '#6a5443' : '#e3b98f') + '"/>';
    // 墙上小画
    b += '<rect x="56" y="86" width="96" height="72" rx="10" fill="' + (night ? '#5d4a3c' : '#fffdf6') + '" opacity=".9"/>';
    b += '<circle cx="88" cy="118" r="15" fill="' + P.accent + '" opacity=".75"/>';
    b += '<path d="M64 146 q22 -26 40 -6 q14 -18 40 6Z" fill="' + P.leaf + '" opacity=".7"/>';

    // 桌面
    b += '<rect y="384" width="800" height="176" fill="url(#' + uid + '_wood)"/>';
    b += '<rect y="384" width="800" height="8" fill="#fff" opacity=".26"/>';
    b += '<rect y="384" width="800" height="10" fill="#000" opacity=".06"/>';
    for (var w = 0; w < 7; w++) {
      b += '<line x1="0" y1="' + (408 + w * 24) + '" x2="800" y2="' + (404 + w * 24) + '" stroke="rgba(90,60,34,.10)" stroke-width="1.6"/>';
    }

    // 台灯
    b += '<circle cx="240" cy="316" r="' + (night ? 168 : 110) + '" fill="url(#' + uid + '_lamp)" opacity="' + (night ? 0.95 : 0.5) + '"/>';
    b += '<rect x="234" y="330" width="12" height="50" rx="5" fill="' + (night ? '#8a6c4e' : '#c9a780') + '"/>';
    b += '<path d="M196 330 q44 -62 88 0Z" fill="' + (night ? '#ffd79a' : '#ffe9c8') + '"/>';
    b += '<rect x="206" y="378" width="68" height="10" rx="5" fill="' + (night ? '#8a6c4e' : '#c9a780') + '"/>';

    // 书堆 + 马克杯
    b += '<rect x="586" y="352" width="184" height="18" rx="5" fill="' + (night ? '#7c5a3f' : '#efbd90') + '"/>';
    b += '<rect x="600" y="334" width="156" height="18" rx="5" fill="' + (night ? '#6a4c56' : '#f5c9cd') + '"/>';
    b += '<rect x="616" y="316" width="126" height="18" rx="5" fill="' + (night ? '#4e5f74' : '#bcd9ea') + '"/>';
    b += '<rect x="620" y="382" width="60" height="4" rx="2" fill="#000" opacity=".16"/>';
    b += '<rect x="330" y="354" width="38" height="30" rx="7" fill="' + (night ? '#d8b489' : '#fffaf2') + '"/>';
    b += '<path d="M368 362 q16 4 0 14" stroke="' + (night ? '#d8b489' : '#fffaf2') + '" stroke-width="5" fill="none"/>';
    b += '<path d="M340 344 q-5 -12 2 -18 M352 342 q-5 -12 2 -18" stroke="#fff" stroke-width="2" fill="none" opacity="' + (night ? 0.18 : 0.55) + '" stroke-linecap="round"/>';
    b += '<g transform="rotate(-7 420 392)"><rect x="392" y="386" width="92" height="14" rx="3" fill="' + (night ? '#b9a691' : '#fffdf7') + '" opacity=".9"/></g>';
    b += '<rect x="410" y="380" width="48" height="6" rx="3" fill="' + P.accent + '" transform="rotate(-12 434 383)"/>';

    if (night) b += fireflies(rnd, Math.round(8 * q), 300, 420, '#ffdca0', 0.18);

    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity=".35">' + grassTuft(40, 560, 26, '#000', 0.4) + grassTuft(760, 560, 26, '#000', 0.4) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 3. 暖阳卧室 */
  function sceneBedroom(P, uid, night, thumb) {
    var rnd = mulberry32(31), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_wall', [[0, P.wall[0]], [0.55, P.wall[1]], [1, P.wallLow]], 0, 0, 0.3, 1);
    d += lg(uid + '_floor', [[0, P.floor[0]], [1, P.floor[1]]]);
    d += lg(uid + '_beam', [[0, P.light, night ? 0.2 : 0.4], [1, P.light, 0]], 0, 0, 1, 1);
    d += rg(uid + '_glow', [[0, P.light, night ? 0.95 : 0.5], [0.45, P.light, night ? 0.25 : 0.12], [1, P.light, 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_win', [[0, '#ffffff', night ? 0.06 : 0.35], [1, '#ffffff', 0]], 0.5, 0.5, 0.5);
    d += lg(uid + '_rug', [[0, night ? '#51405a' : '#fff4e6'], [1, night ? '#3b2f45' : '#ffe4cd']]);
    d += seatDef(uid, night ? '#ffd6a0' : '#fff6e2', night ? 0.18 : 0.24);
    d += vignetteDef(uid, '#2a1420', night ? 0.46 : 0.22);
    d += blurDef(uid + '_fg', 3.2);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_wall)"/>';
    // 墙裙 + 腰线
    b += '<rect y="308" width="800" height="120" fill="' + P.wallLow + '" opacity=".55"/>';
    b += '<rect x="0" y="304" width="800" height="6" rx="3" fill="#fff" opacity="' + (night ? 0.12 : 0.4) + '"/>';
    b += '<rect x="0" y="310" width="800" height="2" fill="#000" opacity=".06"/>';
    // 窗光
    b += '<circle cx="600" cy="160" r="300" fill="url(#' + uid + '_win)"/>';

    // 窗（右侧）
    b += '<rect x="472" y="52" width="236" height="220" rx="16" fill="' + P.wood + '"/>';
    b += '<rect x="486" y="66" width="208" height="192" rx="9" fill="' + (night ? '#16233f' : '#cfeaff') + '"/>';
    if (night) {
      b += starsN(rnd, Math.round(22 * q), '#ffffff', 216);
      b += '<circle cx="648" cy="106" r="20" fill="#fff6da"/>';
      b += '<circle cx="640" cy="100" r="16" fill="#16233f" opacity=".55"/>';
    } else {
      b += '<circle cx="648" cy="100" r="22" fill="#fff8dc" opacity=".9"/>';
      b += cloudBlob(556, 118, 0.26, '#ffffff', 0.9);
      b += cloudBlob(660, 156, 0.2, '#ffffff', 0.7);
    }
    // 窗外花园
    b += '<path d="M486 214 q52 -40 104 -6 q54 -28 104 6 l0 44 l-208 0Z" fill="' + (night ? '#1d3a34' : '#9fd18c') + '"/>';
    b += '<path d="M486 232 q60 -22 120 2 q44 14 88 -6 l0 30 l-208 0Z" fill="' + (night ? '#173027' : '#7cbb72') + '"/>';
    for (var wf = 0; wf < Math.round(10 * q); wf++) {
      b += '<circle cx="' + (500 + rnd() * 180).toFixed(0) + '" cy="' + (214 + rnd() * 30).toFixed(0) + '" r="' + (1.6 + rnd() * 2).toFixed(1) +
        '" fill="' + (night ? '#5d7a6a' : ['#ff8fa3', '#ffd166', '#fff0f6'][(rnd() * 3) | 0]) + '" opacity=".9"/>';
    }
    b += '<line x1="590" y1="66" x2="590" y2="258" stroke="' + P.wood + '" stroke-width="8"/>';
    b += '<line x1="486" y1="162" x2="694" y2="162" stroke="' + P.wood + '" stroke-width="7"/>';
    b += '<rect x="464" y="264" width="252" height="16" rx="8" fill="' + P.wood + '"/>';
    b += '<rect x="464" y="264" width="252" height="5" rx="3" fill="#fff" opacity=".24"/>';
    // 窗帘
    b += '<path d="M450 40 q34 112 8 228 l-38 0 0 -228Z" fill="' + P.curtain + '"/>';
    b += '<path d="M450 40 q22 112 4 228 l-18 0 q16 -116 -6 -228Z" fill="#fff" opacity=".16"/>';
    b += '<path d="M726 40 q-34 112 -8 228 l38 0 0 -228Z" fill="' + P.curtain + '"/>';
    b += '<rect x="444" y="34" width="290" height="8" rx="4" fill="' + P.wood + '"/>';
    // 阳光斜落到床尾
    b += '<path d="M492 96 L700 96 L800 470 L430 470Z" fill="url(#' + uid + '_beam)"/>';

    // 地板
    b += '<rect y="428" width="800" height="132" fill="url(#' + uid + '_floor)"/>';
    b += '<line x1="0" y1="428" x2="800" y2="428" stroke="#000" stroke-width="2" opacity=".12"/>';
    for (var p = 0; p < 10; p++) {
      b += '<line x1="' + (p * 104 - 20) + '" y1="428" x2="' + (p * 104 - 90) + '" y2="560" stroke="#000" stroke-width="1.6" opacity=".09"/>';
    }

    // 床
    b += '<ellipse cx="192" cy="500" rx="182" ry="20" fill="#000" opacity="' + (night ? 0.32 : 0.12) + '"/>';
    b += '<rect x="12" y="296" width="352" height="150" rx="18" fill="' + P.wood + '"/>';
    b += '<rect x="26" y="308" width="324" height="126" rx="14" fill="' + P.head + '"/>';
    // 软包拉点
    for (var tf = 0; tf < 4; tf++) {
      for (var tg = 0; tg < 2; tg++) {
        b += '<circle cx="' + (72 + tf * 78) + '" cy="' + (336 + tg * 40) + '" r="3" fill="#000" opacity=".16"/>';
        b += '<circle cx="' + (72 + tf * 78) + '" cy="' + (334 + tg * 40) + '" r="2.4" fill="#fff" opacity=".22"/>';
      }
    }
    b += '<rect x="18" y="356" width="344" height="92" rx="16" fill="' + P.accent + '"/>';
    b += '<rect x="18" y="356" width="344" height="18" rx="9" fill="#fff" opacity=".22"/>';
    // 被子
    b += '<path d="M18 386 q62 -16 124 0 q64 16 126 0 q48 -12 94 2 l0 62 l-344 0Z" fill="' + P.bed + '"/>';
    b += '<path d="M18 386 q62 -16 124 0 q64 16 126 0 q48 -12 94 2" stroke="#fff" stroke-width="2.6" fill="none" opacity=".4"/>';
    for (var bf = 0; bf < 5; bf++) {
      b += '<path d="M' + (54 + bf * 62) + ' 396 q8 24 -2 52" stroke="#000" stroke-width="2" fill="none" opacity=".07"/>';
    }
    b += '<path d="M18 428 q120 22 250 6 q56 -8 94 0 l0 16 l-344 0Z" fill="' + P.bed2 + '" opacity=".55"/>';
    // 枕头
    b += '<rect x="40" y="336" width="112" height="42" rx="18" fill="' + P.accent + '"/>';
    b += '<rect x="40" y="336" width="112" height="12" rx="6" fill="#fff" opacity=".35"/>';
    b += '<rect x="162" y="342" width="104" height="36" rx="16" fill="' + P.pillow + '"/>';
    b += '<rect x="162" y="342" width="104" height="10" rx="5" fill="#fff" opacity=".25"/>';
    // 床腿
    b += '<rect x="26" y="446" width="18" height="34" rx="6" fill="' + P.wood + '"/>';
    b += '<rect x="330" y="446" width="18" height="34" rx="6" fill="' + P.wood + '"/>';

    // 地毯
    b += '<ellipse cx="446" cy="504" rx="228" ry="60" fill="url(#' + uid + '_rug)"/>';
    b += '<ellipse cx="446" cy="504" rx="228" ry="60" fill="none" stroke="' + (night ? '#6a5674' : '#ffc9a8') + '" stroke-width="5" opacity=".7"/>';
    b += '<ellipse cx="446" cy="504" rx="186" ry="45" fill="none" stroke="' + (night ? '#5a4766' : '#ffd7bb') + '" stroke-width="2.4"/>';

    // 床头柜 + 台灯（右侧）
    b += '<rect x="716" y="398" width="74" height="66" rx="10" fill="' + P.wood + '"/>';
    b += '<rect x="716" y="398" width="74" height="10" rx="5" fill="#fff" opacity=".2"/>';
    b += '<rect x="724" y="430" width="58" height="8" rx="4" fill="#000" opacity=".12"/>';
    b += '<circle cx="753" cy="378" r="' + (night ? 120 : 62) + '" fill="url(#' + uid + '_glow)"/>';
    b += '<rect x="748" y="378" width="10" height="24" rx="4" fill="' + (night ? '#8a6c4e' : '#c9a780') + '"/>';
    b += '<path d="M726 380 q27 -42 54 0Z" fill="' + (night ? '#ffd79a' : '#ffeccd') + '"/>';
    b += '<rect x="736" y="402" width="34" height="10" rx="4" fill="' + (night ? '#7d6146' : '#ffe9c8') + '"/>';

    // 挂画
    b += '<rect x="250" y="104" width="86" height="66" rx="9" fill="' + (night ? '#5d4a3c' : '#fffdf6') + '" opacity=".95"/>';
    b += '<rect x="348" y="122" width="70" height="52" rx="9" fill="' + (night ? '#5d4a3c' : '#fffdf6') + '" opacity=".95"/>';
    b += '<circle cx="286" cy="132" r="13" fill="' + P.bed2 + '"/>';
    b += '<path d="M258 162 q24 -22 40 -4 q16 -16 30 4Z" fill="' + (night ? '#3d5040' : '#a9d18e') + '"/>';
    b += '<path d="M358 164 q16 -20 28 -4 q12 -12 22 6Z" fill="' + (night ? '#3d5040' : '#9fc9e8') + '"/>';

    // 吊篮植物
    b += '<path d="M86 0 q8 40 4 58" stroke="' + (night ? '#4a5c4a' : '#a98a63') + '" stroke-width="2.4" fill="none"/>';
    b += '<path d="M52 58 q34 -20 66 0 q-8 24 -33 26 q-25 -2 -33 -26Z" fill="' + (night ? '#3f5a46' : '#e0ac7c') + '"/>';
    for (var v = 0; v < 6; v++) {
      var vx = 62 + v * 9;
      b += '<path d="M' + vx + ' 80 q' + (v % 2 ? -16 : 14) + ' 28 ' + (v % 2 ? -6 : 8) + ' 48" stroke="' +
        (night ? '#3d5a44' : '#8dbb78') + '" stroke-width="2.2" fill="none"/>';
      b += '<circle cx="' + (vx + (v % 2 ? -6 : 6)) + '" cy="' + (102 + v * 5) + '" r="4.2" fill="' +
        (night ? '#4d7050' : '#a8d18c') + '"/>';
    }

    // 拖鞋 + 毛线球
    b += '<g opacity=".95">' +
      '<ellipse cx="212" cy="516" rx="19" ry="10" fill="' + (night ? '#6b5570' : '#ffb6c8') + '"/>' +
      '<ellipse cx="212" cy="509" rx="16" ry="8" fill="' + (night ? '#7d6482' : '#fff0f4') + '"/>' +
      '<ellipse cx="246" cy="528" rx="19" ry="10" fill="' + (night ? '#6b5570' : '#ffb6c8') + '"/>' +
      '<ellipse cx="246" cy="521" rx="16" ry="8" fill="' + (night ? '#7d6482' : '#fff0f4') + '"/></g>';
    b += '<circle cx="590" cy="538" r="16" fill="' + (night ? '#7a6070' : '#ffcf8f') + '"/>';
    b += '<path d="M578 528 q16 10 4 26" stroke="#000" stroke-width="1.4" fill="none" opacity=".18"/>';

    // 床尾毯子
    b += '<rect x="286" y="378" width="74" height="56" rx="8" fill="' + P.throw + '"/>';
    b += '<path d="M286 392 q38 8 74 0 M286 408 q38 8 74 0 M286 424 q38 8 74 0" stroke="#fff" stroke-width="2" fill="none" opacity=".35"/>';
    b += '<rect x="286" y="378" width="74" height="7" rx="3.5" fill="#fff" opacity=".28"/>';
    // 墙上小搁板 + 书 + 小盆栽
    b += '<rect x="116" y="216" width="158" height="9" rx="4" fill="' + P.wood + '"/>';
    b += '<rect x="124" y="184" width="13" height="32" rx="3" fill="' + (night ? '#6d5a64' : '#f2a0ae') + '"/>';
    b += '<rect x="141" y="178" width="11" height="38" rx="3" fill="' + (night ? '#4f6478' : '#9fc9e8') + '"/>';
    b += '<rect x="156" y="188" width="15" height="28" rx="3" fill="' + (night ? '#6a5b44' : '#ffd28f') + '"/>';
    b += '<path d="M196 216 q2 -20 11 -24 q9 6 7 24Z" fill="' + P.leaf + '"/>';
    b += '<rect x="192" y="202" width="26" height="15" rx="4" fill="' + (night ? '#6a5443' : '#e3b98f') + '"/>';
    b += '<rect x="232" y="198" width="30" height="18" rx="3" fill="' + (night ? '#5a4a4a' : '#fffdf6') + '"/>';
    b += '<path d="M238 204 h18 M238 209 h12" stroke="#000" stroke-width="1.4" opacity=".14"/>';
    // 床头柜上的书与杯子
    b += '<rect x="722" y="386" width="42" height="7" rx="3" fill="' + (night ? '#6a5a64' : '#f08fa2') + '"/>';
    b += '<rect x="726" y="379" width="34" height="7" rx="3" fill="' + (night ? '#4f6478' : '#9fc9e8') + '"/>';
    b += '<rect x="752" y="362" width="16" height="14" rx="3" fill="' + (night ? '#cbb08a' : '#fffaf2') + '"/>';
    // 窗光落在地毯上
    b += '<g filter="url(#' + uid + '_fg)" opacity="' + (night ? 0.09 : 0.26) + '">' +
      '<path d="M490 434 L624 434 L700 506 L536 506Z" fill="#fff3cf"/>' +
      '<path d="M624 434 L700 434 L754 488 L700 506Z" fill="#fff3cf"/></g>';
    // 夜晚串灯
    if (night) {
      b += '<path d="M110 60 q150 48 300 12 t262 24" stroke="rgba(255,220,160,.26)" stroke-width="1.6" fill="none"/>';
      for (var n = 0; n < 13; n++) {
        var nx = 116 + n * 50, ny = 70 + Math.sin(n * 0.55) * 18;
        b += '<circle cx="' + nx + '" cy="' + ny + '" r="10" fill="#ffd98a" opacity=".2"/>';
        b += '<circle cx="' + nx + '" cy="' + ny + '" r="2.8" fill="#ffeec0"/>';
      }
      b += fireflies(rnd, Math.round(6 * q), 300, 430, '#ffdca0', 0.14);
    }

    b += seatLight(uid);
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 4. 樱花草原 */
  function sceneSakura(P, uid, night, thumb) {
    var rnd = mulberry32(33), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.35, P.sky[1]], [0.7, P.sky[2]], [1, P.sky[3]]]);
    d += rg(uid + '_sun', [[0, P.sun, 0.85], [0.35, P.sun, 0.25], [1, P.sun, 0]], 0.5, 0.5, 0.5);
    d += lg(uid + '_pond', [[0, P.water], [1, night ? '#12293a' : '#8fd0dd']], 0.2, 0, 0.8, 1);
    d += seatDef(uid, night ? '#e6d5ff' : '#fff6ea', night ? 0.18 : 0.28);
    d += rg(uid + '_canopy', [[0, P.blossom[1], 0.97], [0.45, P.blossom[0], 0.93], [1, P.blossom[0], 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_canopyHi', [[0, P.blossom[1], 0.8], [1, P.blossom[1], 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_canopySh', [[0, night ? '#5d4463' : '#e87aa0', 0.4], [1, night ? '#5d4463' : '#e87aa0', 0]], 0.5, 0.5, 0.5);
    d += vignetteDef(uid, '#2a1730', night ? 0.44 : 0.24);
    d += blurDef(uid + '_fg', 3.4);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) b += starsN(rnd, Math.round(120 * q), '#ffffff', 340);
    b += '<circle cx="188" cy="108" r="' + (night ? 150 : 200) + '" fill="url(#' + uid + '_sun)"/>';
    b += '<circle cx="188" cy="108" r="' + (night ? 40 : 44) + '" fill="' + P.sun + '"/>';
    if (night) b += '<circle cx="176" cy="98" r="36" fill="' + P.sky[1] + '" opacity=".6"/>';
    b += cloudBlob(560, 96, 0.7, night ? '#4c4570' : '#ffffff', night ? 0.26 : 0.7);
    b += cloudBlob(690, 176, 0.5, night ? '#4c4570' : '#ffffff', night ? 0.2 : 0.6);

    // 远山与草地
    b += '<path d="M0 350 C132 300 262 326 386 348 C500 368 640 316 800 340 L800 560 L0 560Z" fill="' + P.hill + '"/>';
    b += '<path d="M0 420 C160 396 320 418 480 430 C620 440 712 418 800 426 L800 560 L0 560Z" fill="' + P.grass[0] + '"/>';

    // 小池塘（左）
    b += '<ellipse cx="150" cy="472" rx="166" ry="56" fill="' + (night ? '#2a3a44' : '#cfe3c2') + '" opacity=".55"/>';
    b += '<ellipse cx="150" cy="472" rx="158" ry="52" fill="url(#' + uid + '_pond)"/>';
    b += '<ellipse cx="150" cy="472" rx="158" ry="52" fill="none" stroke="' + (night ? '#2c4a55' : '#ffffff') + '" stroke-width="3" opacity=".7"/>';
    // 樱花倒影 + 睡莲
    b += '<ellipse cx="196" cy="466" rx="72" ry="30" fill="' + P.blossom[0] + '" opacity="' + (night ? 0.18 : 0.32) + '"/>';
    for (var wl = 0; wl < 5; wl++) {
      b += '<path d="M' + (56 + wl * 18) + ' ' + (458 + wl * 7) + ' q46 -8 92 0" stroke="#ffffff" stroke-width="2" fill="none" opacity="' + (night ? 0.14 : 0.42) + '"/>';
    }
    b += '<ellipse cx="96" cy="452" rx="17" ry="8" fill="' + (night ? '#2f5a4c' : '#8fc97a') + '"/><path d="M96 452 l7 -11" stroke="#fff" stroke-width="2" opacity=".35"/>';
    b += '<ellipse cx="196" cy="494" rx="14" ry="7" fill="' + (night ? '#2f5a4c' : '#8fc97a') + '"/>';
    b += '<circle cx="122" cy="462" r="2.4" fill="#fff" opacity=".8"/>';
    b += '<circle cx="186" cy="482" r="2" fill="#fff" opacity=".7"/>';

    // 樱花树（右侧）
    b += '<path d="M714 560 C700 470 690 420 664 358 C654 332 656 306 670 286" stroke="' + P.trunk + '" stroke-width="30" fill="none" stroke-linecap="round"/>';
    b += '<path d="M668 352 C628 330 600 300 578 268" stroke="' + P.trunk + '" stroke-width="14" fill="none" stroke-linecap="round"/>';
    b += '<path d="M676 322 C704 294 730 280 756 266" stroke="' + P.trunk + '" stroke-width="12" fill="none" stroke-linecap="round"/>';
    b += '<path d="M670 398 C630 390 600 374 578 352" stroke="' + P.trunk + '" stroke-width="9" fill="none" stroke-linecap="round"/>';
    b += '<path d="M684 430 C716 418 742 404 762 386" stroke="' + P.trunk + '" stroke-width="8" fill="none" stroke-linecap="round"/>';

    // 花冠：渐变叠加互相融合，再撒小花粒
    var clusters = [
      [652, 244, 84], [586, 258, 60], [708, 230, 66], [612, 198, 52], [678, 186, 48], [748, 262, 48],
      [552, 290, 44], [566, 340, 38], [716, 312, 42], [764, 300, 38], [636, 296, 46], [700, 350, 30]
    ];
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c], cr = cl[2] * (thumb ? 0.96 : 1);
      b += '<circle cx="' + (cl[0] + cr * 0.16) + '" cy="' + (cl[1] + cr * 0.22) + '" r="' + cr + '" fill="url(#' + uid + '_canopySh)"/>';
      b += '<circle cx="' + cl[0] + '" cy="' + cl[1] + '" r="' + cr + '" fill="url(#' + uid + '_canopy)"/>';
      b += '<circle cx="' + (cl[0] - cr * 0.3) + '" cy="' + (cl[1] - cr * 0.34) + '" r="' + (cr * 0.72) + '" fill="url(#' + uid + '_canopyHi)"/>';
    }
    // 花粒：让花冠有质感，而不是一团粉
    for (var sp = 0; sp < Math.round(130 * q); sp++) {
      var k = clusters[Math.floor(rnd() * clusters.length)], kr = k[2];
      var a2 = rnd() * 6.2832, dd = Math.sqrt(rnd()) * kr * 0.94;
      var px = k[0] + Math.cos(a2) * dd, py = k[1] + Math.sin(a2) * dd;
      b += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (2 + rnd() * 4.4).toFixed(1) +
        '" fill="' + (rnd() > 0.42 ? P.blossom[1] : (night ? '#c9a7cf' : '#fff2f7')) + '" opacity="' + (0.3 + rnd() * 0.42).toFixed(2) + '"/>';
    }
    b += '<path d="M700 560 q-10 -40 -2 -78" stroke="' + (night ? '#1a2a26' : '#7cae63') + '" stroke-width="22" fill="none" opacity=".35"/>';

    // 草地细节
    b += '<path d="M0 476 C150 456 300 476 470 484 C620 490 716 470 800 478 L800 560 L0 560Z" fill="' + P.grass[1] + '"/>';
    for (var g = 0; g < Math.round(30 * q); g++) {
      b += grassTuft(230 + rnd() * 550, 500 + rnd() * 56, 10 + rnd() * 12, night ? '#2b4352' : '#7fb268', 0.55);
    }
    for (var fl = 0; fl < Math.round(16 * q); fl++) {
      b += '<circle cx="' + (220 + rnd() * 570).toFixed(1) + '" cy="' + (498 + rnd() * 56).toFixed(1) + '" r="' +
        (1.4 + rnd() * 1.8).toFixed(1) + '" fill="' + (night ? '#8d6f8c' : '#fff6f8') + '" opacity=".8"/>';
    }
    b += petals(rnd, Math.round(26 * q), 460);

    // 石灯笼（放在池塘右岸，夜景点灯）
    b += '<g opacity="' + (night ? 0.95 : 0.8) + '">' +
      '<rect x="336" y="424" width="10" height="44" rx="4" fill="' + (night ? '#4a4a5c' : '#c9c3b4') + '"/>' +
      '<rect x="322" y="464" width="38" height="10" rx="4" fill="' + (night ? '#3e3e50' : '#b9b3a4') + '"/>' +
      '<path d="M318 424 q23 -26 46 0Z" fill="' + (night ? '#4a4a5c' : '#cfc9ba') + '"/></g>';
    if (night) {
      b += '<circle cx="341" cy="434" r="46" fill="#ffd79a" opacity=".22"/>';
      b += '<circle cx="341" cy="434" r="7" fill="#ffe6b8"/>';
      b += fireflies(rnd, Math.round(16 * q), 320, 500, '#ffe6b0', 0.2);
    }
    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity=".35">' + grassTuft(30, 560, 34, '#000', 0.5) + grassTuft(776, 560, 30, '#000', 0.5) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 5. 月夜城堡 */
  function sceneMoon(P, uid, night, thumb) {
    var rnd = mulberry32(55), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.38, P.sky[1]], [0.7, P.sky[2]], [1, P.sky[3]]]);
    d += rg(uid + '_halo', [[0, P.moon, 0.7], [0.28, P.moon, 0.2], [1, P.moon, 0]], 0.5, 0.5, 0.5);
    d += lg(uid + '_lake', [[0, P.lake[0]], [0.55, P.lake[1]], [1, '#060c18']]);
    d += lg(uid + '_fog', [[0, P.moon, 0], [0.5, P.moon, night ? 0.2 : 0.14], [1, P.moon, 0]]);
    d += lg(uid + '_mw', [[0, '#9aa8ff', 0], [0.45, '#b9b0ff', 0.18], [0.62, '#9fc4ff', 0.14], [1, '#9aa8ff', 0]], 0, 0.4, 1, 0.6);
    d += seatDef(uid, night ? '#a8c8ff' : '#ffe0b8', night ? 0.14 : 0.2);
    d += vignetteDef(uid, '#050a18', night ? 0.42 : 0.26);
    d += blurDef(uid + '_soft', 7);
    d += blurDef(uid + '_fg', 3.4);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    b += starsN(rnd, Math.round((night ? 180 : 80) * q), night ? '#ffffff' : P.star, 420);

    // 月亮
    b += '<circle cx="628" cy="112" r="176" fill="url(#' + uid + '_halo)"/>';
    b += '<circle cx="628" cy="112" r="48" fill="' + P.moon + '"/>';
    b += '<circle cx="614" cy="100" r="9" fill="' + P.sky[1] + '" opacity=".14"/>';
    b += '<circle cx="640" cy="132" r="6" fill="' + P.sky[1] + '" opacity=".12"/>';
    b += '<circle cx="646" cy="96" r="4.5" fill="' + P.sky[1] + '" opacity=".1"/>';
    // 薄云（模糊，不用硬椭圆）
    b += '<g filter="url(#' + uid + '_soft)" opacity="' + (night ? 0.22 : 0.32) + '">' +
      '<ellipse cx="196" cy="150" rx="180" ry="17" fill="' + P.moon + '"/>' +
      '<ellipse cx="530" cy="196" rx="210" ry="13" fill="' + P.moon + '"/>' +
      '<ellipse cx="720" cy="256" rx="150" ry="11" fill="' + P.moon + '"/></g>';

    // 远山
    b += '<path d="M0 406 C110 334 210 360 306 388 C404 416 506 346 606 372 C690 394 752 366 800 380 L800 560 L0 560Z" fill="' + P.ground + '" opacity=".42"/>';
    b += '<path d="M0 430 C130 400 260 424 400 436 C540 448 660 420 800 432 L800 560 L0 560Z" fill="' + P.ground + '" opacity=".62"/>';

    // 城堡（偏左，避开角色）
    var cst = P.castle, rim = night ? '#8ea2cc' : '#f6e4ff';
    b += '<g fill="' + cst + '">' +
      '<rect x="96" y="344" width="228" height="94"/>' +
      '<rect x="112" y="300" width="44" height="140"/>' +
      '<rect x="186" y="272" width="54" height="168"/>' +
      '<rect x="268" y="318" width="40" height="122"/>' +
      '<rect x="72" y="366" width="30" height="74"/>' +
      '<path d="M112 300 L134 250 L156 300Z"/>' +
      '<path d="M186 272 L213 208 L240 272Z"/>' +
      '<path d="M268 318 L288 270 L308 318Z"/>' +
      '<path d="M72 366 L87 330 L102 366Z"/>' +
      '<path d="M213 208 L213 190 L234 196 L213 202Z"/>' +
      '</g>';
    // 城垛
    for (var bt = 0; bt < 6; bt++) {
      b += '<rect x="' + (102 + bt * 38) + '" y="336" width="18" height="12" fill="' + cst + '"/>';
    }
    // 月光棱线
    b += '<g fill="' + rim + '" opacity="' + (night ? 0.34 : 0.3) + '">' +
      '<rect x="112" y="302" width="4" height="138"/><rect x="186" y="274" width="4" height="166"/>' +
      '<rect x="268" y="320" width="4" height="120"/><rect x="72" y="368" width="3.5" height="72"/>' +
      '<path d="M112 300 L134 254 L138 258 L116 300Z"/><path d="M186 272 L213 212 L217 216 L190 272Z"/></g>';
    // 城门与窗
    b += '<path d="M180 438 v-30 q20 -18 40 0 v30Z" fill="' + (night ? '#0c1220' : '#3d2f4a') + '"/>';
    b += '<circle cx="200" cy="420" r="14" fill="' + (night ? '#ffd98a' : '#ffe7b5') + '" opacity=".22"/>';
    var win = [[122, 316], [122, 348], [196, 288], [196, 322], [216, 288], [216, 322],
      [278, 334], [278, 366], [82, 380], [82, 408], [146, 366], [246, 374], [154, 400], [256, 402]];
    for (var i = 0; i < win.length; i++) {
      b += '<rect x="' + win[i][0] + '" y="' + win[i][1] + '" width="6" height="10" rx="3" fill="' +
        (night ? '#ffd98a' : '#ffe7b5') + '" opacity=".92"/>';
      if (night) b += '<circle cx="' + (win[i][0] + 3) + '" cy="' + (win[i][1] + 5) + '" r="6" fill="#ffd98a" opacity=".12"/>';
    }
    // 城堡脚下的树影
    b += '<g fill="' + (night ? '#0a1220' : '#3b2f47') + '" opacity=".8">' +
      '<path d="M60 438 q10 -26 20 0Z"/><path d="M348 438 q12 -30 24 0Z"/><path d="M330 440 q8 -20 16 0Z"/></g>';

    // 湖面
    b += '<rect y="438" width="800" height="122" fill="url(#' + uid + '_lake)"/>';
    b += '<rect y="436" width="800" height="3" fill="' + P.moon + '" opacity=".22"/>';
    // 月光在水面拉出的光带
    b += '<path d="M604 438 L652 438 L700 560 L556 560Z" fill="' + P.moon + '" opacity="' + (night ? 0.07 : 0.06) + '"/>';
    for (var gl = 0; gl < Math.round(16 * q); gl++) {
      var gy = 446 + gl * 7;
      b += '<rect x="' + (596 + Math.sin(gl * 1.6) * 20).toFixed(1) + '" y="' + gy + '" width="' + (12 + rnd() * 40).toFixed(1) +
        '" height="2" rx="1" fill="' + P.moon + '" opacity="' + (0.12 + rnd() * 0.22).toFixed(2) + '"/>';
    }
    // 城堡倒影
    b += '<g transform="translate(0 876) scale(1 -1)" opacity="' + (night ? 0.14 : 0.1) + '">' +
      '<g fill="' + cst + '"><rect x="96" y="344" width="228" height="94"/><rect x="186" y="272" width="54" height="80"/>' +
      '<rect x="112" y="300" width="44" height="60"/></g></g>';
    // 涟漪
    for (var rp = 0; rp < Math.round(9 * q); rp++) {
      b += '<path d="M' + (60 + rnd() * 680).toFixed(0) + ' ' + (470 + rnd() * 70).toFixed(0) + ' q18 -4 36 0" stroke="' +
        P.moon + '" stroke-width="1.6" fill="none" opacity=".12"/>';
    }

    // 雾带
    b += '<rect y="414" width="800" height="52" fill="url(#' + uid + '_fog)"/>';

    // 木栈桥（角色站这里）
    b += '<rect x="286" y="466" width="230" height="15" rx="6" fill="' + (night ? '#6b5668' : '#9c7a58') + '"/>';
    b += '<rect x="286" y="466" width="230" height="4" rx="2" fill="#fff" opacity="' + (night ? 0.22 : 0.18) + '"/>';
    for (var pk = 0; pk < 6; pk++) {
      b += '<line x1="' + (306 + pk * 38) + '" y1="466" x2="' + (302 + pk * 38) + '" y2="481" stroke="#000" stroke-width="1.4" opacity=".2"/>';
    }
    b += '<rect x="296" y="481" width="12" height="44" rx="5" fill="' + (night ? '#4a3d4e' : '#7c5c44') + '"/>';
    b += '<rect x="492" y="481" width="12" height="44" rx="5" fill="' + (night ? '#4a3d4e' : '#7c5c44') + '"/>';
    b += '<path d="M302 498 q92 10 196 -4" stroke="' + (night ? '#6a586c' : '#9c7a58') + '" stroke-width="2" fill="none" opacity=".6"/>';
    // 桥头灯


    if (night) b += fireflies(rnd, Math.round(12 * q), 420, 530, '#ffe3a8', 0.16);
    b += seatLight(uid);
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 6. 海盐沙滩 */
  function sceneBeach(P, uid, night, thumb) {
    var rnd = mulberry32(67), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.58, P.sky[1]], [1, P.sky[2]]]);
    d += rg(uid + '_sun', [[0, P.sun, 0.9], [0.3, P.sun, 0.3], [1, P.sun, 0]], 0.5, 0.5, 0.5);
    d += lg(uid + '_sea', [[0, P.sea[0]], [0.5, P.sea[1]], [1, P.sea[2]]]);
    d += lg(uid + '_sand', [[0, P.sand[0]], [1, P.sand[1]]]);
    d += rg(uid + '_glit', [[0, P.sun, 0.5], [0.5, P.sun, 0.16], [1, P.sun, 0]], 0.5, 0.5, 0.5);
    d += seatDef(uid, night ? '#ffe9b8' : '#fff8e6', night ? 0.18 : 0.26);
    d += vignetteDef(uid, '#1a2030', night ? 0.44 : 0.24);
    d += blurDef(uid + '_fg', 3.4);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) b += starsN(rnd, Math.round(150 * q), '#ffffff', 280);
    b += '<circle cx="612" cy="116" r="190" fill="url(#' + uid + '_sun)"/>';
    b += '<circle cx="612" cy="116" r="42" fill="' + P.sun + '"/>';
    if (night) b += '<circle cx="598" cy="106" r="38" fill="' + P.sky[1] + '" opacity=".62"/>';
    b += cloudBlob(148, 124, 0.9, night ? '#3f4a72' : '#ffffff', night ? 0.24 : 0.85);
    b += cloudBlob(340, 90, 0.6, night ? '#3f4a72' : '#ffffff', night ? 0.2 : 0.7);
    b += cloudBlob(716, 188, 0.5, night ? '#3f4a72' : '#ffffff', night ? 0.16 : 0.6);
    if (!night) {
      b += '<g stroke="#4a5a72" stroke-width="2" fill="none" stroke-linecap="round" opacity=".35">' +
        '<path d="M356 138 q9 -7 18 0 q9 -7 18 0"/><path d="M402 164 q7 -5 14 0 q7 -5 14 0"/></g>';
    }

    // 海
    b += '<rect y="292" width="800" height="188" fill="url(#' + uid + '_sea)"/>';
    // 远处小岛
    b += '<path d="M0 296 q54 -24 108 -6 q30 8 44 8 l0 10 l-152 0Z" fill="' +
      (night ? '#12303c' : '#7fc9a4') + '" opacity="' + (night ? 0.5 : 0.85) + '"/>';
    b += '<path d="M0 296 q54 -24 108 -6 q30 8 44 8" stroke="#ffffff" stroke-width="1.6" fill="none" opacity=".3"/>';
    b += '<rect y="290" width="800" height="5" fill="' + P.sun + '" opacity="' + (night ? 0.28 : 0.4) + '"/>';
    for (var wv = 0; wv < (night ? 6 : 8); wv++) {
      var wy = 312 + wv * (night ? 26 : 20), wx = -60 + (wv * 91) % 130;
      b += '<path d="M' + wx + ' ' + wy + ' q70 -7 140 0 t140 0 t140 0 t140 0" stroke="#ffffff" stroke-width="2" fill="none" opacity="' + (night ? 0.07 : 0.24) +
        '" stroke-dasharray="' + (90 + (wv % 3) * 55) + ' ' + (26 + (wv % 4) * 18) + '"/>';
    }
    // 阳光在水面拉出的光带
    b += '<ellipse cx="604" cy="336" rx="126" ry="176" fill="url(#' + uid + '_glit)" opacity="' + (night ? 0.5 : 0.8) + '"/>';
    for (var gl = 0; gl < Math.round(22 * q); gl++) {
      var gy = 306 + gl * 8;
      b += '<rect x="' + (574 + Math.sin(gl * 1.7) * 26).toFixed(1) + '" y="' + gy + '" width="' + (10 + rnd() * 34).toFixed(1) +
        '" height="2.2" rx="1" fill="' + P.sun + '" opacity="' + (0.3 + rnd() * 0.45).toFixed(2) + '"/>';
    }
    // 浪花
    b += '<path d="M0 424 q80 -16 160 -4 q96 14 190 -2 q100 -16 200 -2 q120 16 250 -6 L800 470 L0 470Z" fill="' + P.sand[0] + '" opacity=".55"/>';
    b += '<path d="M0 436 q90 -14 180 0 q110 16 220 -2 q110 -16 220 0 q90 12 180 -4" stroke="#ffffff" stroke-width="3" fill="none" opacity="' + (night ? 0.2 : 0.6) + '"/>';
    b += '<path d="M0 452 q110 -12 220 2 q120 14 240 -4 q120 -14 240 4" stroke="#ffffff" stroke-width="2" fill="none" opacity="' + (night ? 0.14 : 0.4) + '"/>';

    // 沙滩
    b += '<path d="M0 452 C160 440 320 462 480 470 C620 478 716 456 800 462 L800 560 L0 560Z" fill="url(#' + uid + '_sand)"/>';
    b += '<path d="M0 452 C160 440 320 462 480 470 C620 478 716 456 800 462" stroke="#ffffff" stroke-width="2.4" fill="none" opacity="' + (night ? 0.12 : 0.5) + '"/>';
    for (var sh = 0; sh < Math.round(16 * q); sh++) {
      b += '<ellipse cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (486 + rnd() * 66).toFixed(1) + '" rx="' + (2 + rnd() * 4).toFixed(1) +
        '" ry="' + (1.4 + rnd() * 2).toFixed(1) + '" fill="' + (night ? '#4a4f66' : '#ffffff') + '" opacity="' + (0.25 + rnd() * 0.4).toFixed(2) + '"/>';
    }
    // 海星
    b += '<g transform="translate(660 516) scale(.8)" fill="' + (night ? '#8a6a72' : '#ff9f8a') + '" opacity=".9">' +
      '<path d="M0 -14 L4 -4 L14 -2 L6 5 L8 15 L0 9 L-8 15 L-6 5 L-14 -2 L-4 -4Z"/></g>';
    // 沙滩球与贝壳
    b += '<g transform="translate(542 520)">' +
      '<circle r="15" fill="' + (night ? '#5d5670' : '#fffaf2') + '"/>' +
      '<path d="M0 -15 A15 15 0 0 1 13 7 L0 0Z" fill="' + (night ? '#8a6a76' : '#ff8f8f') + '"/>' +
      '<path d="M0 -15 A15 15 0 0 0 -13 7 L0 0Z" fill="' + (night ? '#6a6480' : '#7fd4e8') + '"/>' +
      '<circle r="15" fill="none" stroke="#000" stroke-width="1" opacity=".1"/></g>';
    b += '<path d="M590 544 q9 -9 18 0 q-9 9 -18 0Z" fill="' + (night ? '#8a7280' : '#ffd9c4') + '"/>';

    // 遮阳伞 + 浴巾（左）
    b += '<circle cx="176" cy="392" r="' + (night ? 96 : 120) + '" fill="' + P.sun + '" opacity="' + (night ? 0.06 : 0.14) + '"/>';
    b += '<rect x="172" y="352" width="7" height="104" rx="3" fill="' + (night ? '#5c5468' : '#e7d8c4') + '"/>';
    b += '<path d="M96 360 q78 -74 158 0 q-78 16 -158 0Z" fill="' + P.parasol[0] + '"/>';
    b += '<path d="M118 358 q18 -34 38 -46 q-30 26 -26 48Z" fill="' + P.parasol[1] + '" opacity=".9"/>';
    b += '<path d="M200 358 q-10 -32 -30 -46 q26 26 22 46Z" fill="' + P.parasol[1] + '" opacity=".75"/>';
    b += '<g transform="rotate(-8 300 480)"><rect x="236" y="470" width="132" height="34" rx="9" fill="' + (night ? '#4f4a64' : '#ffe1c8') + '" opacity=".95"/></g>';
    b += '<circle cx="392" cy="504" r="13" fill="' + (night ? '#5a5470' : '#ffd166') + '" opacity=".9"/>';
    b += '<path d="M392 492 q10 0 12 10" stroke="#fff" stroke-width="2" fill="none" opacity=".45"/>';

    // 椰子树（右）
    b += '<path d="M742 560 C730 500 722 450 706 404" stroke="' + P.palm + '" stroke-width="13" fill="none" stroke-linecap="round"/>';
    b += '<g fill="' + P.palm + '">' +
      '<path d="M706 402 q-48 -26 -76 -6 q40 -30 78 -8Z"/>' +
      '<path d="M706 402 q44 -30 78 -14 q-44 -16 -78 2Z"/>' +
      '<path d="M706 402 q-30 -44 -22 -70 q30 34 26 68Z"/>' +
      '<path d="M706 402 q30 -42 18 -72 q-24 38 -14 70Z"/>' +
      '<path d="M706 402 q-56 4 -78 28 q44 -8 78 -16Z"/>' +
      '<path d="M706 402 q52 6 70 32 q-40 -12 -72 -20Z"/></g>';
    b += '<circle cx="700" cy="410" r="5" fill="' + P.palm + '"/>';

    // 脚印
    for (var ft = 0; ft < 5; ft++) {
      b += '<ellipse cx="' + (470 + ft * 26) + '" cy="' + (536 - ft * 12) + '" rx="4.4" ry="6" fill="#000" opacity="' + (night ? 0.16 : 0.08) + '"/>';
      b += '<ellipse cx="' + (452 + ft * 26) + '" cy="' + (528 - ft * 12) + '" rx="4" ry="5.4" fill="#000" opacity="' + (night ? 0.14 : 0.07) + '"/>';
    }
    if (night) {
      b += fireflies(rnd, Math.round(10 * q), 420, 540, '#9fe8ff', 0.16);
      b += bokehN(rnd, Math.round(14 * q), 300, 470, ['#9fe8ff', '#ffffff'], 1.5, 3.2, 0.4);
    }
    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity=".3">' + grassTuft(24, 560, 30, '#000', 0.4) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 7. 苔藓森林 */
  function sceneForest(P, uid, night, thumb) {
    var rnd = mulberry32(83), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.6, P.sky[1]], [1, night ? '#0c2a26' : '#a8d4a0']]);
    d += lg(uid + '_fog', [[0, P.light, 0], [0.5, P.light, night ? 0.14 : 0.3], [1, P.light, 0]]);
    d += lg(uid + '_water', [[0, P.water], [1, night ? '#0e2a2c' : '#5fb0ab']]);
    d += lg(uid + '_ray', [[0, P.light, night ? 0.34 : 0.42], [1, P.light, 0]], 0, 0, 0, 1);
    d += rg(uid + '_clearing', [[0, P.light, night ? 0.22 : 0.38], [1, P.light, 0]], 0.5, 0.5, 0.5);
    d += rg(uid + '_moon', [[0, P.light, night ? 0.4 : 0.35], [1, P.light, 0]], 0.5, 0.5, 0.5);
    d += seatDef(uid, night ? '#a8e8cf' : '#fff4c8', night ? 0.14 : 0.2);
    d += vignetteDef(uid, '#07160f', night ? 0.36 : 0.3);
    d += blurDef(uid + '_soft', 9);
    d += blurDef(uid + '_fg', 3.4);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';

    // 天光 / 月亮
    b += '<circle cx="596" cy="72" r="' + (night ? 190 : 240) + '" fill="url(#' + uid + '_moon)"/>';
    if (night) {
      b += '<circle cx="596" cy="72" r="26" fill="#fffbe8"/>';
      b += '<circle cx="586" cy="66" r="21" fill="' + P.sky[1] + '" opacity=".5"/>';
      b += starsN(rnd, Math.round(30 * q), '#ffffff', 150);
    }

    // 远景树干
    b += '<g fill="' + P.far + '" opacity=".55">';
    for (var i = 0; i < 7; i++) {
      var tx = 20 + i * 120 + rnd() * 26, tw = 14 + rnd() * 18;
      b += '<rect x="' + tx.toFixed(1) + '" y="0" width="' + tw.toFixed(1) + '" height="' + (320 + rnd() * 80).toFixed(1) + '" rx="6"/>';
    }
    b += '</g>';
    // 林间雾
    b += '<rect y="230" width="800" height="190" fill="url(#' + uid + '_fog)" opacity="' + (night ? 0.55 : 0.34) + '"/>';

    // 中景树干（带月光棱线）
    var trunks = [[92, 44, 560], [708, 50, 560], [206, 26, 500], [604, 30, 500], [330, 16, 420], [500, 18, 430]];
    for (var t = 0; t < trunks.length; t++) {
      var tr = trunks[t], x = tr[0], w = tr[1], h = tr[2];
      b += '<path d="M' + x + ' 560 C' + (x - 8) + ' ' + (560 - h * 0.38) + ' ' + (x + 12) + ' ' + (560 - h * 0.72) +
        ' ' + (x + 2) + ' ' + (560 - h) +         '" stroke="' + (t < 2 ? P.mid : P.near) + '" stroke-width="' + w +
        '" fill="none" stroke-linecap="round"/>';
      b += '<path d="M' + (x - w * 0.3) + ' 548 C' + (x - 8 - w * 0.3) + ' ' + (560 - h * 0.4) + ' ' + (x + 12 - w * 0.3) + ' ' + (560 - h * 0.7) +
        ' ' + (x - w * 0.1) + ' ' + (560 - h) + '" stroke="' + P.light + '" stroke-width="2.2" fill="none" opacity="' +
        (night ? 0.32 : 0.32) + '"/>';
    }
    // 树根外扩，别像一根插在地上的柱子
    b += '<g fill="' + P.mid + '">' +
      '<path d="M62 560 q26 -16 44 -4 l0 8 l-52 0Z"/><path d="M122 560 q-20 -14 -40 -6 l0 8 l48 0Z"/>' +
      '<path d="M676 560 q26 -16 46 -4 l0 8 l-54 0Z"/><path d="M738 560 q-20 -14 -40 -6 l0 8 l48 0Z"/></g>';
    // 树皮纹理
    for (var bk = 0; bk < Math.round(8 * q); bk++) {
      var by = 470 + rnd() * 70;
      b += '<path d="M' + (60 + rnd() * 120) + ' ' + by + ' q6 -22 2 -44" stroke="#000" stroke-width="1.6" fill="none" opacity=".16"/>';
      b += '<path d="M' + (680 + rnd() * 80) + ' ' + by + ' q-6 -22 -2 -44" stroke="#000" stroke-width="1.6" fill="none" opacity=".16"/>';
    }

    // 树冠：三层，越近越深
    b += '<g opacity=".55" filter="url(#' + uid + '_soft)">';
    for (var c1 = 0; c1 < Math.round(10 * q); c1++) {
      b += '<ellipse cx="' + (rnd() * 800).toFixed(0) + '" cy="' + (-20 + rnd() * 90).toFixed(0) + '" rx="' + (70 + rnd() * 60).toFixed(0) +
        '" ry="' + (34 + rnd() * 26).toFixed(0) + '" fill="' + P.far + '"/>';
    }
    b += '</g>';
    b += '<g opacity=".9">';
    for (var c2 = 0; c2 < Math.round(16 * q); c2++) {
      var lx = rnd() * 800, ly = -10 + rnd() * 110, lr = 26 + rnd() * 44;
      b += '<circle cx="' + lx.toFixed(0) + '" cy="' + ly.toFixed(0) + '" r="' + lr.toFixed(0) + '" fill="' + P.canopy + '"/>';
      b += '<circle cx="' + (lx - lr * 0.3).toFixed(0) + '" cy="' + (ly - lr * 0.3).toFixed(0) + '" r="' + (lr * 0.6).toFixed(0) +
        '" fill="' + (night ? '#1d5048' : '#48906c') + '" opacity=".7"/>';
    }
    b += '</g>';
    // 垂下的枝叶
    b += '<g fill="' + P.near + '" opacity=".9">' +
      '<path d="M0 0 q70 40 96 96 q-56 -22 -96 -6Z"/>' +
      '<path d="M800 0 q-60 46 -78 104 q52 -26 78 -10Z"/></g>';
    for (var lf = 0; lf < Math.round(7 * q); lf++) {
      var lx2 = 40 + rnd() * 720, ly2 = 90 + rnd() * 50;
      b += '<path d="M' + lx2.toFixed(0) + ' ' + ly2.toFixed(0) + ' q10 14 2 28" stroke="' + P.near + '" stroke-width="2" fill="none" opacity=".7"/>';
    }

    // 光柱（模糊边缘）
    b += '<circle cx="612" cy="78" r="' + (night ? 210 : 260) + '" fill="url(#' + uid + '_moon)" opacity="' + (night ? 0.7 : 0.5) + '"/>';
    b += '<g filter="url(#' + uid + '_soft)" opacity="' + (night ? 0.95 : 1) + '">' +
      '<path d="M330 0 L452 0 L372 470 L246 470Z" fill="url(#' + uid + '_ray)"/>' +
      '<path d="M556 0 L626 0 L580 420 L500 420Z" fill="url(#' + uid + '_ray)" opacity=".7"/></g>';

    // 地面
    b += '<path d="M0 440 C140 418 280 444 420 452 C560 460 690 436 800 446 L800 560 L0 560Z" fill="' + P.ground[0] + '"/>';
    b += '<path d="M0 500 C180 484 340 508 500 512 C630 516 720 498 800 504 L800 560 L0 560Z" fill="' + P.ground[1] + '"/>';
    b += '<path d="M0 440 C140 418 280 444 420 452 C560 460 690 436 800 446" stroke="' + P.light + '" stroke-width="2.4" fill="none" opacity="' + (night ? 0.1 : 0.24) + '"/>';
    // 中央空地：一束月光落在角色脚下
    b += '<ellipse cx="408" cy="470" rx="200" ry="86" fill="url(#' + uid + '_clearing)"/>';

    // 月光小径
    b += '<path d="M330 560 Q366 512 388 468 L470 468 Q486 514 512 560Z" fill="' + P.light + '" opacity="' + (night ? 0.09 : 0.18) + '"/>';
    // 小溪（左）
    b += '<path d="M0 448 C96 464 128 500 82 560 L-24 560 L-24 448Z" fill="url(#' + uid + '_water)" opacity=".95"/>';
    b += '<path d="M0 448 C96 464 128 500 82 560" stroke="' + P.light + '" stroke-width="2.4" fill="none" opacity="' + (night ? 0.2 : 0.4) + '"/>';
    for (var wl2 = 0; wl2 < 5; wl2++) {
      b += '<path d="M' + (8 + wl2 * 10) + ' ' + (474 + wl2 * 16) + ' q34 6 54 0" stroke="#fff" stroke-width="2" fill="none" opacity="' + (night ? 0.16 : 0.45) + '"/>';
    }
    // 溪边石头
    b += '<g fill="' + (night ? '#2c4a42' : '#9aa88e') + '">' +
      '<ellipse cx="118" cy="492" rx="20" ry="12"/><ellipse cx="148" cy="506" rx="12" ry="8"/>' +
      '<ellipse cx="96" cy="516" rx="15" ry="9"/></g>';
    b += '<ellipse cx="112" cy="487" rx="12" ry="5" fill="' + (night ? '#3f6558' : '#b9c9a8') + '" opacity=".8"/>';

    // 蕨类
    for (var fr = 0; fr < Math.round(11 * q); fr++) {
      var fx2 = 210 + rnd() * 520, fy2 = 486 + rnd() * 54;
      var dir = rnd() > 0.5 ? 1 : -1;
      b += '<g opacity="' + (night ? 0.62 : 0.8) + '" stroke="' + (night ? '#3a7a63' : '#4e8f63') + '" stroke-width="2.2" fill="none">';
      for (var lf2 = 0; lf2 < 5; lf2++) {
        b += '<path d="M' + fx2 + ' ' + fy2 + ' q' + (dir * (12 + lf2 * 11)) + ' ' + (-12 - lf2 * 3) + ' ' + (dir * (24 + lf2 * 15)) + ' ' + (4 - lf2 * 4) + '"/>';
      }
      b += '</g>';
    }
    // 蘑菇
    var mushrooms = [[276, 516], [306, 524], [320, 512], [578, 506], [606, 514], [632, 504], [180, 538]];
    for (var m = 0; m < mushrooms.length; m++) {
      var mx2 = mushrooms[m][0], my2 = mushrooms[m][1], ms = 1.15 + (m % 3) * 0.28;
      b += '<g transform="translate(' + mx2 + ' ' + my2 + ') scale(' + ms.toFixed(2) + ')">' +
        '<rect x="-3" y="-10" width="6" height="14" rx="3" fill="' + (night ? '#cfe4d8' : '#fff8ec') + '"/>' +
        '<path d="M-13 -10 q13 -17 26 0Z" fill="' + (night ? '#8ff0d6' : '#ff8fa3') + '"/>' +
        '<circle cx="-5" cy="-14" r="1.8" fill="#fff" opacity=".7"/><circle cx="4" cy="-12" r="1.4" fill="#fff" opacity=".6"/></g>';
      if (night) {
        b += '<circle cx="' + mx2 + '" cy="' + (my2 - 12) + '" r="26" fill="#7be0c4" opacity=".18"/>';
      }
    }
    if (night) b += fireflies(rnd, Math.round(22 * q), 300, 530, '#a8ffe0', 0.2);
    else b += bokehN(rnd, Math.round(10 * q), 200, 450, ['#ffffff', '#fff3c4'], 2, 5, 0.28);

    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity=".55">' + grassTuft(14, 540, 54, '#04110c', 0.5) +
      grassTuft(786, 540, 58, '#04110c', 0.5) + grassTuft(110, 540, 34, '#04110c', 0.4) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  /* 8. 星轨天台 */
  function sceneRooftop(P, uid, night, thumb) {
    var rnd = mulberry32(97), q = thumb ? 0.45 : 1, d = '', b = '';
    d += lg(uid + '_sky', [[0, P.sky[0]], [0.42, P.sky[1]], [0.76, P.sky[2]], [1, P.sky[3]]]);
    d += rg(uid + '_sun', [[0, P.sun, 0.8], [0.35, P.sun, 0.22], [1, P.sun, 0]], 0.5, 0.5, 0.5);
    d += lg(uid + '_floor', [[0, P.floor[0]], [1, P.floor[1]]]);
    d += lg(uid + '_cityGlow', [[0, P.accent, 0.35], [1, P.accent, 0]], 0, 0, 0, 1);
    d += seatDef(uid, night ? '#ffd9a0' : '#fff0d0', night ? 0.18 : 0.24);
    d += rg(uid + '_bulb', [[0, '#fffbe8', 0.9], [0.3, '#ffe0a0', 0.42], [0.62, '#ffb85c', 0.12], [1, '#ff9a3c', 0]], 0.5, 0.5, 0.5);
    d += vignetteDef(uid, '#120e2a', night ? 0.42 : 0.3);
    d += blurDef(uid + '_fg', 3.2);

    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) {
      b += starsN(rnd, Math.round(150 * q), '#ffffff', 300);
      // 月亮
      b += '<circle cx="620" cy="120" r="58" fill="#fffbe8" opacity=".14"/>';
      b += '<circle cx="620" cy="120" r="30" fill="#fff8dc"/>';
      b += '<circle cx="610" cy="112" r="25" fill="' + P.sky[1] + '" opacity=".55"/>';
      // 星轨
      for (var tr = 0; tr < 4; tr++) {
        var rr = 130 + tr * 46;
        b += '<circle cx="620" cy="120" r="' + rr + '" fill="none" stroke="#cdd6ff" stroke-width="1.1" opacity="' + (0.1 + tr * 0.02) + '" stroke-dasharray="70 220"/>';
      }
    } else {
      b += '<circle cx="196" cy="148" r="150" fill="url(#' + uid + '_sun)"/>';
      b += '<circle cx="196" cy="148" r="38" fill="' + P.sun + '"/>';
      b += '<g stroke="' + P.sun + '" stroke-width="2" opacity=".22" fill="none">' +
        '<path d="M196 60 L196 30 M196 236 L196 266 M110 148 L80 148 M282 148 L312 148"/></g>';
    }
    b += cloudBlob(560, 96, 0.7, night ? '#3c3a68' : '#ffd9c2', night ? 0.18 : 0.55);
    b += cloudBlob(700, 178, 0.5, night ? '#3c3a68' : '#ffd9c2', night ? 0.14 : 0.4);

    // 远景城市（两层）
    var skyline = function (baseY, col, seed, op) {
      var r = mulberry32(seed), o = '<g fill="' + col + '" opacity="' + op + '">';
      var x = -20;
      while (x < 820) {
        var w = 34 + r() * 54, h = 60 + r() * 130;
        o += '<rect x="' + x.toFixed(0) + '" y="' + (baseY - h).toFixed(0) + '" width="' + w.toFixed(0) + '" height="' + h.toFixed(0) + '" rx="3"/>';
        if (r() > 0.6) o += '<rect x="' + (x + w * 0.4).toFixed(0) + '" y="' + (baseY - h - 18).toFixed(0) + '" width="5" height="18" rx="2"/>';
        x += w + 10 + r() * 16;
      }
      return o + '</g>';
    };
    b += skyline(452, P.city, 11, 0.55);
    b += skyline(462, P.city2, 23, 0.85);
    // 城市灯窗
    var winR = mulberry32(31);
    for (var cw = 0; cw < Math.round(80 * q); cw++) {
      b += '<rect x="' + (winR() * 800).toFixed(0) + '" y="' + (352 + winR() * 96).toFixed(0) + '" width="3.4" height="5" fill="' +
        P.lights + '" opacity="' + (night ? 0.25 + winR() * 0.6 : 0.18) + '"/>';
    }
    if (night) {
      // 霓虹招牌：给远景一点颜色
      b += '<g opacity=".8">' +
        '<rect x="104" y="392" width="58" height="11" rx="4" fill="#ff6fa5"/>' +
        '<circle cx="98" cy="397" r="14" fill="#ff6fa5" opacity=".28"/>' +
        '<rect x="330" y="418" width="46" height="9" rx="4" fill="#5fe0cd"/>' +
        '<circle cx="352" cy="422" r="14" fill="#5fe0cd" opacity=".25"/>' +
        '<rect x="566" y="404" width="38" height="10" rx="4" fill="#ffc94d"/>' +
        '<circle cx="584" cy="409" r="13" fill="#ffc94d" opacity=".25"/></g>';
    }
    // 城市辉光
    b += '<rect y="360" width="800" height="120" fill="url(#' + uid + '_cityGlow)" opacity="' + (night ? 0.7 : 0.35) + '"/>';

    // 天台地面
    b += '<rect y="456" width="800" height="104" fill="url(#' + uid + '_floor)"/>';
    b += '<line x1="0" y1="456" x2="800" y2="456" stroke="#fff" stroke-width="2" opacity=".22"/>';
    for (var tl = 0; tl < 9; tl++) {
      b += '<line x1="' + (tl * 100 - 40) + '" y1="456" x2="' + (tl * 100 - 100) + '" y2="560" stroke="#000" stroke-width="1.6" opacity=".1"/>';
    }
    // 矮女儿墙（左右各一段，中间留给角色）
    b += '<rect x="0" y="428" width="196" height="34" rx="6" fill="' + P.floor[1] + '"/>';
    b += '<rect x="0" y="424" width="196" height="8" rx="4" fill="#fff" opacity=".2"/>';
    b += '<rect x="612" y="428" width="188" height="34" rx="6" fill="' + P.floor[1] + '"/>';
    b += '<rect x="612" y="424" width="188" height="8" rx="4" fill="#fff" opacity=".2"/>';

    // 串灯
    b += '<path d="M-10 96 q120 62 240 36 q120 -26 240 18 q120 42 240 4 q60 -18 110 -10" stroke="rgba(255,255,255,.28)" stroke-width="1.6" fill="none"/>';
    for (var bl = 0; bl < 13; bl++) {
      var bx = 40 + bl * 58, by = 112 + Math.sin(bl * 0.62) * 26;
      b += '<circle cx="' + bx + '" cy="' + by + '" r="' + (night ? 19 : 12) + '" fill="url(#' + uid + '_bulb)"/>';
      b += '<circle cx="' + bx + '" cy="' + by + '" r="3.6" fill="#fff6d8"/>';
    }

    // 坐垫 + 小桌（左）
    b += '<ellipse cx="150" cy="504" rx="86" ry="22" fill="#000" opacity=".12"/>';
    b += '<path d="M74 496 q0 -32 76 -32 q76 0 76 32 q0 20 -76 20 q-76 0 -76 -20Z" fill="' + (night ? '#6a5578' : '#ffc4b4') + '"/>';
    b += '<path d="M78 490 q0 -24 72 -24 q72 0 72 24 q-72 16 -144 0Z" fill="#fff" opacity=".18"/>';
    b += '<rect x="236" y="478" width="86" height="10" rx="5" fill="' + (night ? '#4a3f5c' : '#b98a63') + '"/>';
    b += '<rect x="246" y="488" width="8" height="34" rx="4" fill="' + (night ? '#3c334c' : '#a97a55') + '"/>';
    b += '<rect x="304" y="488" width="8" height="34" rx="4" fill="' + (night ? '#3c334c' : '#a97a55') + '"/>';
    b += '<rect x="258" y="462" width="18" height="16" rx="4" fill="' + (night ? '#d8b489' : '#fffaf2') + '"/>';
    b += '<circle cx="292" cy="468" r="8" fill="' + (night ? '#ffd79a' : '#ffb3c8') + '"/>';

    // 盆栽 + 纸灯笼（右）
    b += '<path d="M660 470 q-26 -34 -6 -56 q20 16 12 56Z" fill="' + (night ? '#2f5548' : '#7fbf8c') + '"/>';
    b += '<path d="M676 470 q22 -38 44 -30 q-4 30 -38 36Z" fill="' + (night ? '#2a4c42' : '#6cae7c') + '"/>';
    b += '<rect x="650" y="468" width="60" height="34" rx="8" fill="' + (night ? '#4a3b3f' : '#e0a98a') + '"/>';
    b += '<circle cx="740" cy="420" r="' + (night ? 44 : 30) + '" fill="' + P.lights + '" opacity="' + (night ? 0.2 : 0.1) + '"/>';
    b += '<path d="M722 424 q18 -30 36 0 q0 22 -18 22 q-18 0 -18 -22Z" fill="' + (night ? '#ffcf8a' : '#ffe4b5') + '"/>';
    b += '<rect x="736" y="440" width="8" height="30" rx="4" fill="' + (night ? '#4a3b3f' : '#d9a07e') + '"/>';

    if (night) b += fireflies(rnd, Math.round(8 * q), 380, 520, '#ffe6b0', 0.16);
    b += seatLight(uid);
    b += '<g filter="url(#' + uid + '_fg)" opacity=".3">' + grassTuft(24, 560, 24, '#000', 0.4) + grassTuft(778, 560, 24, '#000', 0.4) + '</g>';
    b += vignetteRect(uid);
    return [d, b];
  }

  var SCR = {
    flower: sceneFlower, desk: sceneDesk, bedroom: sceneBedroom, sakura: sceneSakura,
    moon: sceneMoon, beach: sceneBeach, forest: sceneForest, rooftop: sceneRooftop
  };
  var SCENE_META = [
    { id: 'flower', name: '花海晴空', em: '🌼' },
    { id: 'desk', name: '云端书桌', em: '☁️' },
    { id: 'bedroom', name: '暖阳卧室', em: '🛏️' },
    { id: 'sakura', name: '樱花草原', em: '🌸' },
    { id: 'moon', name: '月夜城堡', em: '🌙' },
    { id: 'beach', name: '海盐沙滩', em: '🐚' },
    { id: 'forest', name: '苔藓森林', em: '🌿' },
    { id: 'rooftop', name: '星轨天台', em: '✨' }
  ];

  function sceneSVG(id, night, thumb) {
    var uid = 'q' + (++uidSeq);
    var P = PALETTES[id][night ? 'night' : 'day'];
    var parts = SCR[id](P, uid, night, !!thumb);
    return '<svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' + parts[0] + '</defs>' + parts[1] + '</svg>';
  }

  /* ---------------- DOM ---------------- */
  var sceneRow = $('#sceneRow'), sceneBg = $('#sceneBg'), sceneFx = $('#sceneFx');
  var petStage = $('#petStage');
  var petImg = $('#petImg'), petSprite = $('#petSprite'), bubble = $('#bubble');
  var moodText = $('#moodText'), chatLog = $('#chatLog'), chatInput = $('#chatInput');
  var heroPet = $('#heroPet'), heroDesc = $('#heroDesc'), dexGrid = $('#dexGrid');
  var bubbleTimer = null;

  // 宠物高度按舞台实际像素算，避免百分比高度在绝对定位里失准
  function fitPet() {
    var h = petStage.clientHeight || 480;
    var size = Math.max(190, Math.min(360, Math.round(h * 0.62)));
    petImg.style.height = size + 'px';
  }
  window.addEventListener('resize', fitPet);

  /* ---------------- 场景 ---------------- */
  function renderSceneCards() {
    sceneRow.innerHTML = SCENE_META.map(function (m) {
      return '<div class="scene-card' + (m.id === state.scene ? ' on' : '') + '" data-scene="' + m.id + '">' +
        sceneSVG(m.id, state.night, true) +
        '<span class="sc-time">' + (state.night ? '🌙' : '☀') + '</span>' +
        '<span class="sc-name">' + m.name + '</span></div>';
    }).join('');
    syncSceneArrows();
  }

  // 只把选中的卡挪进可视区（贴边留 8px），不做居中，避免两侧都出现半张卡
  function keepActiveCardVisible(smooth) {
    var act = sceneRow.querySelector('.scene-card.on');
    if (!act) return;
    var view = sceneRow.scrollLeft, w = sceneRow.clientWidth;
    var l = act.offsetLeft, r = l + act.clientWidth;
    var left = view;
    if (l < view + 8) left = l - 8;
    else if (r > view + w - 8) left = r - w + 8;
    left = Math.max(0, Math.min(sceneRow.scrollWidth - w, left));
    if (left === view) return;
    if (smooth && sceneRow.scrollTo) sceneRow.scrollTo({ left: left, behavior: 'smooth' });
    else sceneRow.scrollLeft = left;
  }

  function syncSceneArrows() {
    var prev = $('#scenePrev'), next = $('#sceneNext');
    if (!prev || !next) return;
    var max = sceneRow.scrollWidth - sceneRow.clientWidth - 2;
    prev.disabled = sceneRow.scrollLeft <= 2;
    next.disabled = sceneRow.scrollLeft >= max;
  }

  function nudgeScenes(step) {
    var card = sceneRow.querySelector('.scene-card');
    var w = card ? card.clientWidth + 12 : 180;
    if (sceneRow.scrollBy) sceneRow.scrollBy({ left: step * w, behavior: 'smooth' });
    else sceneRow.scrollLeft += step * w;
  }

  function paintScene(animate) {
    sceneBg.innerHTML = '<div class="zoom" style="width:100%;height:100%">' + sceneSVG(state.scene, state.night) + '</div>';
    if (animate !== false) sceneBg.firstChild.classList.add('zoom');
    makeParticles();
  }

  function setScene(id) {
    state.scene = id;
    save();
    renderSceneCards();
    paintScene(true);
    keepActiveCardVisible(true);
  }

  function setNight(night) {
    state.night = !!night;
    save();
    renderSceneCards();
    paintScene(true);
    syncTimeUI();
  }

  function syncTimeUI() {
    $$('#segTime button').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.t === 'night') === state.night);
    });
    $('#btnTime').textContent = state.night ? '🌙 夜晚 · 换场景' : '☀ 白天 · 换场景';
  }

  function makeParticles() {
    sceneFx.innerHTML = '';
    var kind = state.scene;
    var FLAKES = {
      sakura: { n: 16, cls: 'petal', col: 'rgba(255,190,210,.9)' },
      flower: { n: 10, cls: 'petal', col: 'rgba(255,214,226,.85)' },
      beach: { n: 9, cls: 'petal mote', col: 'rgba(214,246,255,.9)' },
      forest: { n: 10, cls: 'petal mote', col: 'rgba(190,255,224,.85)' },
      rooftop: { n: 9, cls: 'petal mote', col: 'rgba(255,232,180,.9)' },
      moon: { n: 10, cls: 'petal mote', col: 'rgba(200,220,255,.85)' }
    };
    var cfg = FLAKES[kind] || { n: state.night ? 11 : 9, cls: 'petal mote', col: 'rgba(255,240,200,.9)' };
    var n = cfg.n;
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = cfg.cls;
      var size = (cfg.cls === 'petal' ? 6 : 4) + Math.random() * 5;
      s.style.cssText = 'left:' + (Math.random() * 96).toFixed(1) + '%;' +
        'width:' + size.toFixed(1) + 'px;height:' + (cfg.cls === 'petal' ? size * 0.8 : size).toFixed(1) + 'px;' +
        'animation-duration:' + (7 + Math.random() * 8).toFixed(1) + 's;' +
        'animation-delay:-' + (Math.random() * 10).toFixed(1) + 's;' +
        'opacity:0;background:' + cfg.col + ';';
      sceneFx.appendChild(s);
    }
  }

  /* ---------------- 宠物 ---------------- */
  function renderPet(keepBubble) {
    var p = pet();
    petImg.src = p.texture;
    petImg.alt = p.name;
    fitPet();
    heroPet.src = p.texture;
    document.title = '星宠语 · ' + p.name + '的宠物小屋';
    moodText.textContent = p.desc || '';
    heroDesc.textContent = p.desc || '';
    document.documentElement.style.setProperty('--accent', p.accent || '#ff9f5a');
    renderCharm();
    if (!keepBubble) bubble.textContent = '';
  }

  function say(text, ms) {
    bubble.textContent = text;
    bubble.classList.add('on');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.classList.remove('on'); }, ms || 4200);
  }

  function hop() {
    petSprite.classList.remove('happy');
    void petSprite.offsetWidth;
    petSprite.classList.add('happy');
    setTimeout(function () { petSprite.classList.remove('happy'); }, 1100);
  }

  function switchPet(step) {
    state.idx = (state.idx + (step || 1) + DATA.length) % DATA.length;
    save();
    renderPet();
    renderDex();
    say(pet().quote || '换好啦，今天也一起玩吧～');
    hop();
    pushMsg(pet().name, pet().quote || '换好啦～', false);
  }

  /* ---------------- 聊天 ---------------- */
  function pushMsg(who, text, me) {
    var p = pet();
    var el = document.createElement('div');
    el.className = 'msg' + (me ? ' me' : '');
    el.innerHTML =
      '<div class="ava">' + (me ? '🙂' : '<img src="' + p.texture + '" alt="">') + '</div>' +
      '<div class="body"><div class="who">' + who + '</div><div class="txt"></div></div>';
    el.querySelector('.txt').textContent = text;
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
    return el;
  }

  /* ---------------- 对话规则 ----------------
   * 每条规则的 a(nswer) 是纯函数：给定上下文返回固定文本。
   * matchChatRule 为纯函数，便于单测覆盖「问名字 -> 报名字」等关键路径。
   */
  var CHAT_RULES = [
    {
      id: 'setname', k: ['我叫', '我是', '叫我'],
      a: function (c) {
        var m = c.raw.match(/我(?:叫|是)\s*([^\s，,。！!？?、]{1,8})/) || c.raw.match(/叫我\s*([^\s，,。！!？?、]{1,8})/);
        if (!m) return '嗯？你叫什么呀，我没听清。';
        state.userName = m[1]; save();
        return '「' + m[1] + '」…真好听。\n以后我就这么叫你啦，' + m[1] + '。';
      }
    },
    {
      id: 'name', k: ['你叫什么', '叫什么名字', '你的名字', '名字', '你是谁', '你叫啥'],
      a: function (c) {
        return '我叫' + c.name + '呀，是' + (c.element || '星光') + '做的小家伙。\n你怎么称呼？';
      }
    },
    {
      id: 'age', k: ['几岁', '多大', '年龄'],
      a: function (c) { return '按你们的算法…我大概三岁。\n不过我不太在意这个，' + (c.user ? c.user : '你') + '。'; }
    },
    {
      id: 'remember', k: ['记住', '记得我'],
      a: function (c) { return c.user ? ('记住啦，' + c.user + '。\n我把你的名字放在心里最里面的那格。') : '记住啦，写在心里的那种。'; }
    },
    {
      id: 'hi', k: ['你好', '您好', '嗨', 'hi', 'hello', '在吗', '在么', '早安', '晚上好', '下午好', '早上好'],
      a: function (c) {
        var h = new Date().getHours();
        var g = h < 11 ? '早上好呀' : (h < 18 ? '下午好呀' : '晚上好呀');
        return g + '～' + (c.user ? c.user + '，' : '') + '我刚在' + c.sceneName + '发呆呢。';
      }
    },
    {
      id: 'feed', k: ['吃', '饿', '喂', '给你', '拿去吧', '好吃', '香吗', '饼干', '草莓'],
      a: function (c) {
        state.full = Math.min(100, state.full + 8); save();
        return '哇！是给我的吗？\n我不挑的，你给什么我都喜欢——' + (c.pickTag === '甜品' ? '甜的我最喜欢啦。' : '分你一半～');
      }
    },
    {
      id: 'full', k: ['吃饱', '还要吗', '再来点', '够吗'],
      a: function () { return '已经吃得很饱啦～\n剩下的留到晚上，我们一起吃。'; }
    },
    {
      id: 'pet', k: ['摸摸', '摸一下', '抱抱', '可爱', '好软', '喜欢你', '摸我'],
      a: function (c) {
        state.mood = Math.min(100, state.mood + 6); save();
        return '（耳朵轻轻抖了抖）\n' + (c.user ? c.user + '，' : '') + '你一摸我，我就什么都不想了。';
      }
    },
    {
      id: 'sleep', k: ['睡', '困', '累', '休息', '晚安'],
      a: function () { return '那我陪你安静一会儿。\n眼睛闭一下就好，我守着。'; }
    },
    {
      id: 'play', k: ['玩', '走', '出去', '散步', '游戏', '陪我'],
      a: function () { return '走走走！我要走在你前面一点点。\n去哪都行，只要跟你一起。'; }
    },
    {
      id: 'mood', k: ['心情', '难过', '不开心', '生气', '孤单', '伤心'],
      a: function (c) { return '（把脑袋轻轻靠过来）\n' + (c.user ? c.user + '，' : '') + '我今天的心情是' + c.moodWord + '。\n你来了，就好了。'; }
    },
    {
      id: 'praise', k: ['漂亮', '好看', '厉害', '棒', '真乖', '夸'],
      a: function () { return '（害羞地把脸埋进爪子里）\n被你这么一说，尾巴都翘起来了。'; }
    },
    {
      id: 'thanks', k: ['谢谢', '感谢', '谢谢你'],
      a: function () { return '不用谢呀～\n你肯跟我说话，我就已经很开心了。'; }
    },
    {
      id: 'bye', k: ['再见', '拜拜', '走了', '下次见', '晚点见'],
      a: function () { return '（抬起爪子挥了挥）\n路上小心，我在这儿等你回来。'; }
    },
    {
      id: 'where', k: ['这是哪', '这里是', '什么地方', '在哪', '家里', '小屋'],
      a: function (c) { return '这里是我们的' + c.sceneName + '呀。\n你点一下场景卡，我带你去别的地方。'; }
    },
    {
      id: 'help', k: ['怎么玩', '能做什么', '帮助', '教我', '不会玩'],
      a: function () { return '你可以换场景、给我穿搭、喂东西，也能点「说话」陪我聊天。\n点场景卡我就带你过去。'; }
    }
  ];

  function matchChatRule(text) {
    var low = String(text || '').toLowerCase();
    // 最长关键词优先：避免「怎么玩」被宽泛的「玩」抢先命中成 play。
    // 纯函数，同输入必得同结果，便于单测。
    var best = null, bestLen = -1;
    for (var i = 0; i < CHAT_RULES.length; i++) {
      var r = CHAT_RULES[i];
      for (var j = 0; j < r.k.length; j++) {
        var kw = r.k[j];
        if (low.indexOf(kw) >= 0 && kw.length > bestLen) {
          best = r; bestLen = kw.length;
        }
      }
    }
    return best;
  }

  // 语气只做轻度改写，不改变语义（温柔姐姐=原样；元气少女更活泼；安静陪伴更轻）
  function applyTone(text, tone) {
    if (tone === '元气少女') {
      return '锵锵！' + text.replace(/呀～/g, '！').replace(/～/g, '！');
    }
    if (tone === '安静陪伴') {
      return '（轻轻蹭了蹭）' + text.replace(/！/g, '。').replace(/～/g, '。');
    }
    return text;
  }

  function chatContext(raw) {
    var p = pet();
    var sel = $('#toneSel');
    var sceneNames = {
      flower: '花园', desk: '书桌', bedroom: '卧室', sakura: '樱花树下',
      moon: '月亮城堡', beach: '海边', forest: '森林里', rooftop: '天台'
    };
    var moodWord = state.mood >= 75 ? '亮亮的' : (state.mood >= 45 ? '平静的' : '有点闷的');
    return {
      raw: String(raw || ''), name: p.name, element: p.element, pickTag: (p.tags || [])[0],
      user: state.userName || '', sceneName: sceneNames[state.scene] || '小屋',
      moodWord: moodWord, tone: sel ? sel.value : '温柔姐姐'
    };
  }

  function composeReply(raw) {
    var c = chatContext(raw);
    var rule = matchChatRule(c.raw);
    var text;
    if (rule) {
      text = rule.a(c);
    } else {
      var fallbacks = [
        '（歪了歪头）我没太听懂…\n你是想问「' + c.name + '在做什么」吗？',
        '这个我不太懂诶…\n不过你愿意跟我说话，我就很开心了。',
        '（把爪子搭在你手上）\n你想说什么都可以，我听着呢。'
      ];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
    return applyTone(text, c.tone);
  }

  function petReply(userText) {
    var p = pet();
    var text = composeReply(userText);
    setTimeout(function () {
      pushMsg(p.name, text, false);
      say(text);
      state.bond = Math.min(100, state.bond + 2);
      renderStat();
      save();
    }, 520 + Math.random() * 420);
  }

  function sendChat() {
    var v = (chatInput.value || '').trim();
    if (!v) return;
    pushMsg('我', v, true);
    chatInput.value = '';
    petReply(v);
  }

  /* ---------------- 穿搭 ---------------- */
  var CHARMS = [
    { em: '', nm: '素净', ds: '什么都不戴' },
    { em: '🌸', nm: '樱花簪', ds: '春天的小心思' },
    { em: '🍃', nm: '小叶子', ds: '森林的味道' },
    { em: '⭐', nm: '星光结', ds: '夜里也亮亮的' },
    { em: '🎀', nm: '缎带', ds: '今天想被夸' },
    { em: '🔔', nm: '小铃铛', ds: '走一步响一下' }
  ];

  function renderCharm() {
    var old = petSprite.querySelector('.charm');
    if (old) old.remove();
    var c = CHARMS[state.charm | 0];
    if (c && c.em) {
      var s = document.createElement('span');
      s.className = 'charm';
      s.textContent = c.em;
      petSprite.appendChild(s);
    }
  }

  function renderLook() {
    $('#lookGrid').innerHTML = CHARMS.map(function (c, i) {
      return '<button class="look-item' + (i === (state.charm | 0) ? ' on' : '') + '" data-charm="' + i + '">' +
        '<div class="em">' + (c.em || '○') + '</div><div class="nm">' + c.nm + '</div>' +
        '<div class="ds">' + c.ds + '</div></button>';
    }).join('');
  }

  /* ---------------- 喂食 ---------------- */
  var FOODS = [
    { em: '🍪', nm: '小饼干', full: 8, mood: 6 },
    { em: '🍓', nm: '草莓', full: 6, mood: 9 },
    { em: '⭐', nm: '星星糖', full: 4, mood: 12 },
    { em: '🥛', nm: '温牛奶', full: 10, mood: 5 }
  ];

  function renderFeed() {
    $('#feedGrid').innerHTML = FOODS.map(function (f, i) {
      return '<button class="feed-item" data-food="' + i + '">' +
        '<div class="em">' + f.em + '</div><div class="nm">' + f.nm + '</div></button>';
    }).join('');
  }

  function feed(i) {
    var f = FOODS[i];
    state.full = Math.min(100, state.full + f.full);
    state.mood = Math.min(100, state.mood + f.mood);
    state.bond = Math.min(100, state.bond + 1);
    save();
    renderStat();
    hop();
    var line = state.full >= 100 ? '吃不下了…肚子圆圆的。' : f.nm + '！谢谢你，好好吃～';
    say(line);
    pushMsg(pet().name, line, false);
  }

  /* ---------------- 状态 ---------------- */
  function moodWord() {
    if (state.mood >= 88) return '开心';
    if (state.mood >= 70) return '平静';
    if (state.mood >= 45) return '有点闷';
    return '想你';
  }

  function renderStat() {
    var rows = [
      { k: '饱食度', v: state.full, c: 'peach' },
      { k: '心情', v: state.mood, c: 'pink' },
      { k: '亲密度', v: state.bond, c: 'mint' }
    ];
    $('#statList').innerHTML = rows.map(function (r) {
      return '<div class="stat-row"><div class="lbl"><span>' + r.k + '</span><b>' + Math.round(r.v) + '%</b></div>' +
        '<div class="bar ' + r.c + '"><i style="width:' + Math.round(r.v) + '%"></i></div></div>';
    }).join('') +
      '<div class="stat-note">已经陪你 <b>' + state.streak + '</b> 天。<br/>' +
      '心情「' + moodWord() + '」· 亲密度随聊天和喂食慢慢涨。<br/>数据只存在这台电脑的浏览器里。</div>';
    $('#stMood').textContent = moodWord();
    $('#stLv').textContent = 'Lv.' + Math.max(1, Math.min(9, 1 + Math.floor(state.bond / 12)));
    $('#streakNo').textContent = state.streak;
  }

  /* ---------------- 心情日记：近 7 天打卡趋势 ---------------- */
  var MOOD_FACE = ['', '😢', '😕', '😐', '🙂', '😄'];
  var MOOD_COLOR = ['', '#d98a8a', '#e6a97e', '#e8c96a', '#f0a86a', '#ff9f5a'];

  function moodDaily() {
    var entries = (window.MOOD_LOG || []);
    var now = Date.now();
    var dayMs = 86400000;
    var days = [];
    for (var d = 6; d >= 0; d--) {
      var start = new Date(); start.setHours(0, 0, 0, 0);
      var ms = start.getTime() - d * dayMs;
      var next = ms + dayMs;
      var hits = entries.filter(function (e) {
        var t = (+e.ts > 1e12) ? +e.ts : (+e.ts * 1000);
        return t >= ms && t < next;
      });
      var label = (new Date(ms).getMonth() + 1) + '/' + new Date(ms).getDate();
      var avg = hits.length
        ? Math.round(hits.reduce(function (s, e) { return s + (+e.score || 3); }, 0) / hits.length * 10) / 10
        : null;
      days.push({ label: label, avg: avg, count: hits.length });
    }
    return days;
  }

  function renderMoodChart(days) {
    var box = $('#moodChart');
    var hasData = days.some(function (d) { return d.avg !== null; });
    if (!hasData) {
      box.innerHTML = '<div class="mood-empty">还没有心情记录。<br/>去桌宠右键「今天心情如何」打第一次卡吧～</div>';
      return;
    }
    var W = 520, H = 200, PAD_L = 36, PAD_R = 18, PAD_T = 18, PAD_B = 30;
    var iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
    var x = function (i) { return PAD_L + (iw / 6) * i; };
    var y = function (score) { return PAD_T + ih - ((score - 1) / 4) * ih; };
    var parts = [];
    // 水平参考线（1..5）
    for (var s = 1; s <= 5; s++) {
      var yy = y(s);
      parts.push('<line x1="' + PAD_L + '" y1="' + yy + '" x2="' + (W - PAD_R) + '" y2="' + yy +
        '" stroke="rgba(140,108,76,0.12)" stroke-dasharray="3 4"/>');
      parts.push('<text x="' + (PAD_L - 10) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="#a1968a">' + s + '</text>');
    }
    // 折线 + 面积（跳过无数据的日子，用邻近点连）
    var pts = [];
    for (var i = 0; i < days.length; i++) {
      if (days[i].avg !== null) pts.push([x(i), y(days[i].avg)]);
    }
    if (pts.length > 1) {
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (PAD_T + ih) +
        ' L' + pts[0][0].toFixed(1) + ' ' + (PAD_T + ih) + ' Z';
      parts.push('<path d="' + area + '" fill="rgba(255,159,90,0.14)"/>');
      parts.push('<path d="' + line + '" fill="none" stroke="#ff9f5a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    // 点和日期
    for (var j = 0; j < days.length; j++) {
      var px = x(j);
      parts.push('<text x="' + px + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#a1968a">' + days[j].label + '</text>');
      if (days[j].avg !== null) {
        parts.push('<circle cx="' + px + '" cy="' + y(days[j].avg) + '" r="5" fill="#fffdfa" stroke="#ff9f5a" stroke-width="2.5"/>');
      } else {
        parts.push('<circle cx="' + px + '" cy="' + y(3) + '" r="3" fill="rgba(140,108,76,0.2)"/>');
      }
    }
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + parts.join('') + '</svg>';
  }

  function renderMoodModal() {
    var days = moodDaily();
    renderMoodChart(days);
    var recent = days.filter(function (d) { return d.count > 0; }).slice(-5).reverse();
    $('#moodList').innerHTML = recent.length
      ? recent.map(function (d) {
          var face = MOOD_FACE[Math.round(d.avg)] || '😐';
          var pct = Math.round((d.avg / 5) * 100);
          return '<div class="mood-list-item"><span class="d">' + d.label + '</span>' +
            '<span class="face">' + face + '</span>' +
            '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
            '<b>' + d.avg.toFixed(1) + '</b></div>';
        }).join('')
      : '';
  }

  function openMoodModal() {
    var m = $('#moodModal');
    renderMoodModal();
    m.hidden = false;
  }
  function closeMoodModal() { $('#moodModal').hidden = true; }

  /* ---------------- 图鉴 ---------------- */
  function renderDex() {
    dexGrid.innerHTML = DATA.map(function (p, i) {
      return '<div class="dex-card' + (i === state.idx ? ' on' : '') + '">' +
        '<span class="no">NO.' + ('0' + (i + 1)).slice(-2) + '</span>' +
        '<div class="pic"><img src="' + p.texture + '" alt="' + p.name + '"></div>' +
        '<div class="nm">' + p.name + '</div>' +
        '<div class="en">' + (p.en || '') + '</div>' +
        '<div class="tg">' + (p.tags || []).map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>' +
        '<button class="pick" data-pick="' + i + '">' + (i === state.idx ? '正在小屋' : '带回小屋') + '</button>' +
        '</div>';
    }).join('');
    $('#dexCount').textContent = '共 ' + DATA.length + ' 只小住客';
  }

  /* ---------------- 视图切换 ---------------- */
  function goView(name) {
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'view-' + name); });
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === name); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'dex') renderDex();
  }

  /* ---------------- 事件绑定 ---------------- */
  sceneRow.addEventListener('click', function (e) {
    var card = e.target.closest('.scene-card');
    if (card) setScene(card.dataset.scene);
  });
  sceneRow.addEventListener('scroll', syncSceneArrows, { passive: true });
  window.addEventListener('resize', syncSceneArrows);
  $('#scenePrev').addEventListener('click', function () { nudgeScenes(-1); });
  $('#sceneNext').addEventListener('click', function () { nudgeScenes(1); });

  $('#segTime').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) setNight(b.dataset.t === 'night');
  });

  $('#btnTime').addEventListener('click', function () { setNight(!state.night); });
  $('#btnSwitch').addEventListener('click', function () { switchPet(1); });

  document.addEventListener('click', function (e) {
    if (e.target.closest('#btnMoodLog')) { openMoodModal(); return; }
    if (e.target.closest('#moodClose') || e.target.id === 'moodModal') { closeMoodModal(); return; }
    var nav = e.target.closest('[data-view]');
    if (nav) { e.preventDefault(); goView(nav.dataset.view); }
    var atrium = e.target.closest('#btnAtrium, #btnAtriumTop, #btnAtriumHome');
    if (atrium) { location.href = 'index.html'; }
    if (e.target.closest('#btnRoom3d')) { location.href = '../room3d/index.html'; }
    if (e.target.closest('#btnNest2d')) { location.href = '../house2d/index.html'; }
    var pick = e.target.closest('[data-pick]');
    if (pick) {
      var i = +pick.dataset.pick;
      if (i !== state.idx) {
        state.idx = i; save(); renderPet(); renderDex(); hop();
        say(pet().quote || '我来啦～'); pushMsg(pet().name, pet().quote || '我来啦～', false);
        goView('house');
      } else {
        goView('house');
      }
      return;
    }
    var charm = e.target.closest('[data-charm]');
    if (charm) {
      state.charm = +charm.dataset.charm; save(); renderCharm(); renderLook(); hop();
      say(CHARMS[state.charm].em ? CHARMS[state.charm].nm + '？我戴着好看吗～' : '素净也很好看。');
    }
    var food = e.target.closest('[data-food]');
    if (food) feed(+food.dataset.food);
  });

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    $$('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab); });
  });

  $('#btnSend').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });

  $('#btnMic').addEventListener('click', function () {
    var last = chatLog.querySelector('.msg:last-child .txt');
    var text = last ? last.textContent : (pet().quote || '');
    say(text);
    try {
      if (window.speechSynthesis) {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN'; u.rate = 1.02; u.pitch = 1.22;
        speechSynthesis.speak(u);
      }
    } catch (err) { /* 不支持就算了 */ }
  });

  /* ---------------- 初始化 ---------------- */
  // 支持调试/分享参数：?pet=3&scene=moon&night=1&view=dex
  (function fromURL() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.has('pet')) {
      var n = parseInt(q.get('pet'), 10);
      if (!isNaN(n)) state.idx = Math.max(0, Math.min(DATA.length - 1, n - 1));
    }
    if (q.has('scene') && SCR[q.get('scene')]) state.scene = q.get('scene');
    if (q.get('night') === '1') state.night = true;
  })();

  renderSceneCards();
  paintScene(false);
  syncTimeUI();
  renderPet();
  renderLook();
  renderFeed();
  renderStat();
  renderDex();

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMoodModal();
  });

  var p0 = pet();
  pushMsg(p0.name, p0.quote || '今天也来啦～', false);
  setTimeout(function () { say(p0.quote || '今天也来啦～'); }, 900);

  // 轻度衰减：每次打开掉一点饱食度，避免永远满格
  if (state.full > 40) { state.full = Math.max(40, state.full - 3); save(); renderStat(); }

  try {
    var qs = new URLSearchParams(location.search);
    var v0 = qs.get('view');
    if (v0 && document.getElementById('view-' + v0)) goView(v0);
    var t0 = qs.get('tab');
    if (t0) {
      var tb = document.querySelector('#tabs [data-tab="' + t0 + '"]');
      if (tb) tb.click();
    }
  } catch (e) { /* 忽略 */ }
})();
