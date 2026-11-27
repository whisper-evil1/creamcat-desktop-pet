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

  /* ---------------- 五个场景 ---------------- */
  var PALETTES = {
    flower: {
      day: { sky: ['#bfe4ff', '#e9f7ff', '#fff8ec'], sun: '#fff3c8', cloud: '#ffffff', hill1: '#d3e9c8', hill2: '#bcdda4', meadow: '#a6d489', extra: '#ffd7e1', ray: '#fff6d8' },
      night: { sky: ['#16203a', '#26355a', '#3a4a6d'], sun: '#fff6d6', cloud: '#8ea3c4', hill1: '#233352', hill2: '#1d2a45', meadow: '#182538', extra: '#ffe9a8', ray: '#bcd0ff' }
    },
    desk: {
      day: { wall1: '#f9ebd8', wall2: '#efdcc5', wood1: '#d6ab7b', wood2: '#b98a5d', sky1: '#cbeaff', sky2: '#f0faff', accent: '#ffd7a3', leaf: '#8fc98a' },
      night: { wall1: '#4b3b31', wall2: '#392d26', wood1: '#6e5039', wood2: '#4e3927', sky1: '#16233f', sky2: '#2a3e66', accent: '#ffcb85', leaf: '#3f6b52' }
    },
    bedroom: {
      day: { wall1: '#fcecdd', wall2: '#f4ddc8', bed: '#f8d2d6', bed2: '#ffb9c5', floor: '#e8cbaa', light: '#fff3d2', accent: '#ffffff' },
      night: { wall1: '#3d3449', wall2: '#2f293a', bed: '#5c4555', bed2: '#6e5064', floor: '#342a3b', light: '#ffc98a', accent: '#ffddb0' }
    },
    sakura: {
      day: { sky: ['#fff0f4', '#fdf7ef', '#f1f8e9'], blossom: '#ffc6d5', blossom2: '#ffe1e9', trunk: '#8d6a54', grass: '#b8d99c', hill: '#cde5b8' },
      night: { sky: ['#221d35', '#302c4b', '#3c3959'], blossom: '#7e5b73', blossom2: '#9b718a', trunk: '#4a3830', grass: '#223140', hill: '#293848' }
    },
    moon: {
      day: { sky: ['#ffd9b2', '#eaa9a4', '#8c7aa6'], moon: '#fff4d2', castle: '#6d5a7a', ground: '#4b405d', star: '#fff3d8' },
      night: { sky: ['#0f1932', '#19254a', '#2a3463'], moon: '#fffbe8', castle: '#141c31', ground: '#0d1425', star: '#ffffff' }
    }
  };

  function skyDef(uid, stops) {
    return '<linearGradient id="' + uid + '_sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + stops[0] + '"/>' +
      '<stop offset=".58" stop-color="' + stops[1] + '"/>' +
      '<stop offset="1" stop-color="' + stops[2] + '"/></linearGradient>';
  }

  function cloud(x, y, k, color, op) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + k + ')" fill="' + color + '" opacity="' + (op || 0.85) + '">' +
      '<ellipse rx="48" ry="19"/><ellipse cx="-32" cy="7" rx="30" ry="14"/>' +
      '<ellipse cx="34" cy="6" rx="35" ry="16"/><ellipse cx="4" cy="-14" rx="27" ry="18"/></g>';
  }

  function starField(rnd, n, color, maxY) {
    var o = '';
    for (var i = 0; i < n; i++) {
      var x = rnd() * 800, y = rnd() * (maxY || 300);
      var r = 0.7 + rnd() * 1.5, op = 0.35 + rnd() * 0.6;
      o += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + color + '" opacity="' + op.toFixed(2) + '"/>';
    }
    return o;
  }

  /* 1. 花海晴空 */
  function sceneFlower(P, uid, night) {
    var rnd = mulberry32(7), b = '';
    var d = skyDef(uid, P.sky);
    d += '<radialGradient id="' + uid + '_sun"><stop offset="0" stop-color="' + P.sun + '" stop-opacity=".85"/>' +
      '<stop offset=".45" stop-color="' + P.sun + '" stop-opacity=".28"/><stop offset="1" stop-color="' + P.sun + '" stop-opacity="0"/></radialGradient>';
    d += '<linearGradient id="' + uid + '_ray" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + P.ray + '" stop-opacity=".55"/>' +
      '<stop offset="1" stop-color="' + P.ray + '" stop-opacity="0"/></linearGradient>';
    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) b += starField(rnd, 90, P.star || '#fff', 330);
    b += '<circle cx="640" cy="112" r="130" fill="url(#' + uid + '_sun)"/>';
    b += '<circle cx="640" cy="112" r="36" fill="' + P.sun + '"/>';
    if (night) {
      b += '<circle cx="628" cy="104" r="32" fill="' + P.sky[1] + '"/>';
      b += '<circle cx="628" cy="104" r="31" fill="' + P.sun + '" opacity=".92"/>';
    }
    b += cloud(150, 118, 1, P.cloud, night ? 0.5 : 0.9);
    b += cloud(392, 82, 0.74, P.cloud, night ? 0.42 : 0.85);
    b += cloud(596, 208, 0.56, P.cloud, night ? 0.35 : 0.75);
    b += '<path d="M0 322 C112 280 226 296 330 318 C452 344 528 288 626 298 C706 306 762 286 800 294 L800 560 L0 560Z" fill="' + P.hill1 + '"/>';
    b += '<path d="M0 368 C142 336 262 354 382 370 C502 386 622 350 800 364 L800 560 L0 560Z" fill="' + P.hill2 + '"/>';
    b += '<path d="M0 428 C158 404 302 422 460 434 C600 444 702 422 800 430 L800 560 L0 560Z" fill="' + P.meadow + '"/>';

    // 草叶
    for (var i = 0; i < 46; i++) {
      var gx = rnd() * 800, gy = 440 + rnd() * 118, h = 8 + rnd() * 13;
      b += '<path d="M' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ' q3 -' + (h * 0.7).toFixed(1) + ' 6 0" stroke="' +
        (night ? '#2c4a52' : '#86bb63') + '" stroke-width="1.6" fill="none" opacity=".55"/>';
    }
    // 小花
    for (var j = 0; j < 58; j++) {
      var fx = rnd() * 800, fy = 448 + rnd() * 106, fr = 1.5 + rnd() * 2.2;
      b += '<circle cx="' + fx.toFixed(1) + '" cy="' + fy.toFixed(1) + '" r="' + fr.toFixed(1) +
        '" fill="' + P.extra + '" opacity="' + (0.5 + rnd() * 0.5).toFixed(2) + '"/>';
    }
    b += '<path d="M540 0 L760 0 L470 560 L330 560Z" fill="url(#' + uid + '_ray)" opacity="' + (night ? 0.18 : 0.5) + '"/>';
    if (night) {
      // 萤火
      for (var f = 0; f < 16; f++) {
        b += '<circle cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (390 + rnd() * 150).toFixed(1) + '" r="' +
          (1.2 + rnd() * 1.6).toFixed(1) + '" fill="#ffe9a0" opacity="' + (0.35 + rnd() * 0.45).toFixed(2) + '"/>';
      }
    }
    return [d, b];
  }

  /* 2. 云端书桌 */
  function sceneDesk(P, uid, night) {
    var rnd = mulberry32(21), b = '';
    var d = '<linearGradient id="' + uid + '_wall" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + P.wall1 + '"/><stop offset="1" stop-color="' + P.wall2 + '"/></linearGradient>';
    d += '<linearGradient id="' + uid + '_sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + P.sky1 + '"/><stop offset="1" stop-color="' + P.sky2 + '"/></linearGradient>';
    d += '<linearGradient id="' + uid + '_wood" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + P.wood1 + '"/><stop offset="1" stop-color="' + P.wood2 + '"/></linearGradient>';
    d += '<radialGradient id="' + uid + '_lamp"><stop offset="0" stop-color="' + P.accent + '" stop-opacity=".85"/>' +
      '<stop offset="1" stop-color="' + P.accent + '" stop-opacity="0"/></radialGradient>';

    b += '<rect width="800" height="560" fill="url(#' + uid + '_wall)"/>';
    // 墙板缝
    for (var i = 0; i < 9; i++) b += '<line x1="' + (i * 92) + '" y1="0" x2="' + (i * 92) + '" y2="392" stroke="rgba(120,86,56,.10)" stroke-width="1.5"/>';
    // 窗
    b += '<rect x="462" y="58" width="268" height="214" rx="12" fill="url(#' + uid + '_sky)"/>';
    if (night) {
      var wr = mulberry32(44);
      for (var s2 = 0; s2 < 24; s2++) {
        b += '<circle cx="' + (470 + wr() * 250).toFixed(1) + '" cy="' + (66 + wr() * 196).toFixed(1) +
          '" r="' + (0.8 + wr() * 1.2).toFixed(1) + '" fill="#ffffff" opacity="' + (0.4 + wr() * 0.6).toFixed(2) + '"/>';
      }
    }
    b += cloud(556, 128, 0.5, night ? '#5d6f92' : '#ffffff', 0.8);
    b += cloud(660, 190, 0.62, night ? '#5d6f92' : '#ffffff', 0.7);
    if (night) b += '<circle cx="688" cy="102" r="17" fill="#fff7de"/>';
    b += '<rect x="462" y="58" width="268" height="214" rx="12" fill="none" stroke="' + (night ? '#7a5f45' : '#e3c9a8') + '" stroke-width="9"/>';
    b += '<line x1="596" y1="58" x2="596" y2="272" stroke="' + (night ? '#7a5f45' : '#e3c9a8') + '" stroke-width="7"/>';
    b += '<line x1="462" y1="172" x2="730" y2="172" stroke="' + (night ? '#7a5f45' : '#e3c9a8') + '" stroke-width="6"/>';
    // 窗台植物
    b += '<path d="M430 272 q18 -34 34 -6 q12 -30 26 -2 q14 -26 22 8Z" fill="' + P.leaf + '"/>';
    b += '<rect x="424" y="268" width="104" height="16" rx="5" fill="' + (night ? '#5c4634' : '#d9b78f') + '"/>';
    // 桌面
    b += '<rect y="392" width="800" height="168" fill="url(#' + uid + '_wood)"/>';
    b += '<rect y="392" width="800" height="9" fill="rgba(255,255,255,.22)"/>';
    for (var w = 0; w < 7; w++) b += '<line x1="0" y1="' + (410 + w * 22) + '" x2="800" y2="' + (408 + w * 22) + '" stroke="rgba(90,60,34,.10)" stroke-width="1.6"/>';
    // 书堆
    b += '<rect x="566" y="346" width="176" height="20" rx="5" fill="' + (night ? '#7c5a3f' : '#ecb98b') + '"/>';
    b += '<rect x="578" y="326" width="152" height="20" rx="5" fill="' + (night ? '#6a4c56' : '#f5c9cd') + '"/>';
    b += '<rect x="594" y="306" width="122" height="20" rx="5" fill="' + (night ? '#4e5f74' : '#bcd9ea') + '"/>';
    // 台灯（夜景发光）
    b += '<circle cx="252" cy="300" r="' + (night ? 150 : 90) + '" fill="url(#' + uid + '_lamp)" opacity="' + (night ? 0.9 : 0.35) + '"/>';
    b += '<rect x="246" y="300" width="12" height="92" rx="5" fill="' + (night ? '#8a6c4e' : '#c9a780') + '"/>';
    b += '<path d="M212 300 q40 -58 80 0Z" fill="' + (night ? '#ffd79a' : '#ffe6c0') + '"/>';
    b += '<rect x="224" y="392" width="56" height="9" rx="4" fill="' + (night ? '#8a6c4e' : '#c9a780') + '"/>';
    // 纸与笔
    b += '<g transform="rotate(-6 400 400)"><rect x="330" y="386" width="130" height="18" rx="3" fill="' + (night ? '#b9a691' : '#fffdf7') + '" opacity=".95"/></g>';
    b += '<rect x="352" y="380" width="58" height="7" rx="3" fill="' + P.accent + '" transform="rotate(-14 380 383)"/>';
    return [d, b];
  }

  /* 3. 暖阳卧室 */
  function sceneBedroom(P, uid, night) {
    var b = '';
    var d = '<linearGradient id="' + uid + '_wall" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + P.wall1 + '"/><stop offset="1" stop-color="' + P.wall2 + '"/></linearGradient>';
    d += '<linearGradient id="' + uid + '_floor" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + P.floor + '"/><stop offset="1" stop-color="' + (night ? '#2a2231' : '#d6b189') + '"/></linearGradient>';
    d += '<linearGradient id="' + uid + '_beam" x1=".2" y1="0" x2=".8" y2="1">' +
      '<stop offset="0" stop-color="' + P.light + '" stop-opacity=".8"/><stop offset="1" stop-color="' + P.light + '" stop-opacity="0"/></linearGradient>';
    d += '<radialGradient id="' + uid + '_glow"><stop offset="0" stop-color="' + P.light + '" stop-opacity=".9"/>' +
      '<stop offset="1" stop-color="' + P.light + '" stop-opacity="0"/></radialGradient>';

    b += '<rect width="800" height="560" fill="url(#' + uid + '_wall)"/>';
    // 窗
    b += '<rect x="472" y="52" width="176" height="184" rx="10" fill="' + (night ? '#1a2744' : '#cfe9ff') + '"/>';
    b += '<rect x="472" y="52" width="176" height="184" rx="10" fill="none" stroke="' + (night ? '#8c7358' : '#f0d8bb') + '" stroke-width="8"/>';
    b += '<line x1="560" y1="52" x2="560" y2="236" stroke="' + (night ? '#8c7358' : '#f0d8bb') + '" stroke-width="6"/>';
    b += '<line x1="472" y1="146" x2="648" y2="146" stroke="' + (night ? '#8c7358' : '#f0d8bb') + '" stroke-width="6"/>';
    if (night) b += '<circle cx="620" cy="92" r="15" fill="#fff7dd"/>';
    else b += cloud(520, 108, 0.34, '#ffffff', 0.9);
    // 窗帘
    b += '<path d="M456 44 q26 100 6 200 l-30 0 0 -200Z" fill="' + (night ? '#6b5064' : '#ffe9e6') + '" opacity=".95"/>';
    b += '<path d="M664 44 q-26 100 -6 200 l30 0 0 -200Z" fill="' + (night ? '#6b5064' : '#ffe9e6') + '" opacity=".95"/>';
    // 光柱
    b += '<path d="M480 90 L648 90 L790 430 L430 430Z" fill="url(#' + uid + '_beam)" opacity="' + (night ? 0.22 : 0.55) + '"/>';
    // 地板
    b += '<rect y="404" width="800" height="156" fill="url(#' + uid + '_floor)"/>';
    b += '<line x1="0" y1="404" x2="800" y2="404" stroke="rgba(120,86,56,.18)" stroke-width="2"/>';
    for (var p = 0; p < 8; p++) b += '<line x1="' + (p * 116 - 40) + '" y1="404" x2="' + (p * 116 - 90) + '" y2="560" stroke="rgba(120,86,56,.12)" stroke-width="1.6"/>';
    // 床
    b += '<rect x="24" y="330" width="330" height="96" rx="18" fill="' + (night ? '#4b3b4d' : '#f6e3d3') + '"/>';
    b += '<rect x="24" y="352" width="330" height="76" rx="18" fill="' + P.bed + '"/>';
    b += '<path d="M24 372 q80 -18 160 0 q90 20 170 -4 l0 60 l-330 0Z" fill="' + P.bed2 + '" opacity=".75"/>';
    b += '<rect x="48" y="330" width="104" height="40" rx="16" fill="' + P.accent + '" opacity=".95"/>';
    b += '<rect x="24" y="300" width="18" height="132" rx="8" fill="' + (night ? '#3a2d3d' : '#e8cdb4') + '"/>';
    b += '<rect x="336" y="300" width="18" height="132" rx="8" fill="' + (night ? '#3a2d3d' : '#e8cdb4') + '"/>';
    // 地毯
    b += '<ellipse cx="470" cy="486" rx="196" ry="52" fill="' + (night ? '#3b3145' : '#fbeee0') + '"/>';
    b += '<ellipse cx="470" cy="486" rx="150" ry="36" fill="none" stroke="' + (night ? '#4d4157' : '#f2ddc9') + '" stroke-width="2"/>';
    // 床头灯
    b += '<circle cx="700" cy="330" r="' + (night ? 120 : 60) + '" fill="url(#' + uid + '_glow)" opacity="' + (night ? 0.85 : 0.32) + '"/>';
    b += '<rect x="668" y="352" width="64" height="12" rx="5" fill="' + (night ? '#5a4436' : '#dcbb98') + '"/>';
    b += '<rect x="692" y="300" width="16" height="56" rx="6" fill="' + (night ? '#7d6146' : '#c9a781') + '"/>';
    b += '<path d="M666 300 q26 -44 52 0Z" fill="' + (night ? '#ffd79a' : '#ffeccd') + '"/>';
    return [d, b];
  }

  /* 4. 樱花草原 */
  function sceneSakura(P, uid, night) {
    var rnd = mulberry32(33), b = '';
    var d = skyDef(uid, P.sky);
    d += '<radialGradient id="' + uid + '_sg"><stop offset="0" stop-color="#fff6e2" stop-opacity=".9"/>' +
      '<stop offset="1" stop-color="#fff6e2" stop-opacity="0"/></radialGradient>';
    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    if (night) b += starField(rnd, 110, '#ffffff', 340);
    b += '<circle cx="176" cy="104" r="140" fill="url(#' + uid + '_sg)" opacity="' + (night ? 0.35 : 0.85) + '"/>';
    b += '<circle cx="176" cy="104" r="34" fill="' + (night ? '#fff9e6' : '#fff8e6') + '"/>';
    // 远山
    b += '<path d="M0 356 C132 306 262 330 386 352 C500 372 640 320 800 344 L800 560 L0 560Z" fill="' + P.hill + '"/>';
    b += '<path d="M0 424 C160 400 320 420 480 432 C620 442 712 420 800 428 L800 560 L0 560Z" fill="' + P.grass + '"/>';
    // 樱花树（右侧）
    b += '<path d="M700 560 C688 470 676 420 654 356 C646 330 650 306 664 288" stroke="' + P.trunk + '" stroke-width="26" fill="none" stroke-linecap="round"/>';
    b += '<path d="M662 350 C624 330 596 300 574 268" stroke="' + P.trunk + '" stroke-width="13" fill="none" stroke-linecap="round"/>';
    b += '<path d="M672 322 C700 296 726 282 752 268" stroke="' + P.trunk + '" stroke-width="11" fill="none" stroke-linecap="round"/>';
    b += '<path d="M666 396 C626 388 596 372 574 350" stroke="' + P.trunk + '" stroke-width="9" fill="none" stroke-linecap="round"/>';
    // 花冠
    var clusters = [
      [648, 250, 74], [588, 262, 54], [704, 236, 60], [610, 208, 46], [676, 196, 44], [742, 268, 44],
      [556, 288, 40], [566, 336, 34], [712, 316, 38], [760, 300, 34]
    ];
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c];
      b += '<circle cx="' + cl[0] + '" cy="' + cl[1] + '" r="' + cl[2] + '" fill="' + P.blossom + '" opacity=".95"/>';
      b += '<circle cx="' + (cl[0] - cl[2] * 0.3) + '" cy="' + (cl[1] - cl[2] * 0.3) + '" r="' + (cl[2] * 0.62) + '" fill="' + P.blossom2 + '" opacity=".85"/>';
    }
    // 草与野花
    for (var i = 0; i < 34; i++) {
      var gx = rnd() * 660, gy = 440 + rnd() * 116, h = 7 + rnd() * 12;
      b += '<path d="M' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ' q2.5 -' + (h * 0.7).toFixed(1) + ' 5 0" stroke="' +
        (night ? '#2b4352' : '#8dbe6f') + '" stroke-width="1.5" fill="none" opacity=".6"/>';
    }
    for (var f = 0; f < 30; f++) {
      b += '<circle cx="' + (rnd() * 660).toFixed(1) + '" cy="' + (446 + rnd() * 108).toFixed(1) + '" r="' +
        (1.4 + rnd() * 1.8).toFixed(1) + '" fill="' + (night ? '#8d6f8c' : '#fff3f6') + '" opacity=".8"/>';
    }
    return [d, b];
  }

  /* 5. 月夜城堡 */
  function sceneMoon(P, uid, night) {
    var rnd = mulberry32(55), b = '';
    var d = skyDef(uid, P.sky);
    d += '<radialGradient id="' + uid + '_mg"><stop offset="0" stop-color="' + P.moon + '" stop-opacity=".75"/>' +
      '<stop offset=".4" stop-color="' + P.moon + '" stop-opacity=".18"/><stop offset="1" stop-color="' + P.moon + '" stop-opacity="0"/></radialGradient>';
    b += '<rect width="800" height="560" fill="url(#' + uid + '_sky)"/>';
    b += starField(rnd, 150, night ? '#ffffff' : P.star, 400);
    b += '<circle cx="606" cy="122" r="150" fill="url(#' + uid + '_mg)"/>';
    b += '<circle cx="606" cy="122" r="48" fill="' + P.moon + '"/>';
    b += '<circle cx="590" cy="108" r="9" fill="' + P.sky[1] + '" opacity=".18"/>';
    b += '<circle cx="620" cy="140" r="6" fill="' + P.sky[1] + '" opacity=".14"/>';
    // 云带
    b += '<g opacity="' + (night ? 0.35 : 0.5) + '"><ellipse cx="180" cy="150" rx="150" ry="20" fill="' + P.moon + '" opacity=".3"/>' +
      '<ellipse cx="470" cy="196" rx="190" ry="16" fill="' + P.moon + '" opacity=".22"/></g>';
    // 远山
    b += '<path d="M0 400 C120 330 220 356 320 384 C430 414 520 348 620 372 C700 392 760 366 800 378 L800 560 L0 560Z" fill="' + P.ground + '" opacity=".55"/>';
    // 城堡
    b += '<g fill="' + P.castle + '">';
    b += '<rect x="292" y="330" width="216" height="150"/>';
    b += '<rect x="300" y="286" width="44" height="196"/>';
    b += '<rect x="456" y="300" width="40" height="182"/>';
    b += '<rect x="378" y="258" width="48" height="224"/>';
    b += '<path d="M296 286 L322 234 L348 286Z"/>';
    b += '<path d="M374 258 L402 198 L430 258Z"/>';
    b += '<path d="M452 300 L476 250 L500 300Z"/>';
    b += '<rect x="264" y="364" width="34" height="116"/>';
    b += '<path d="M260 364 L281 320 L302 364Z"/>';
    b += '</g>';
    // 窗灯
    var win = [[318, 300], [318, 330], [396, 220], [396, 250], [406, 292], [406, 326], [466, 318], [466, 350], [274, 384], [274, 414], [340, 360], [440, 372]];
    for (var i = 0; i < win.length; i++) {
      b += '<rect x="' + win[i][0] + '" y="' + win[i][1] + '" width="9" height="13" rx="4" fill="' +
        (night ? '#ffd98a' : '#ffe7b5') + '" opacity=".9"/>';
    }
    // 草地
    b += '<path d="M0 468 C170 448 320 462 470 470 C620 478 720 458 800 464 L800 560 L0 560Z" fill="' + P.ground + '"/>';
    b += '<rect y="500" width="800" height="60" fill="' + P.ground + '"/>';
    if (night) {
      for (var f = 0; f < 18; f++) {
        b += '<circle cx="' + (rnd() * 800).toFixed(1) + '" cy="' + (455 + rnd() * 90).toFixed(1) + '" r="' +
          (1.1 + rnd() * 1.4).toFixed(1) + '" fill="#ffe9a0" opacity="' + (0.3 + rnd() * 0.5).toFixed(2) + '"/>';
      }
    }
    return [d, b];
  }

  var SCR = { flower: sceneFlower, desk: sceneDesk, bedroom: sceneBedroom, sakura: sceneSakura, moon: sceneMoon };
  var SCENE_META = [
    { id: 'flower', name: '花海晴空', em: '🌼' },
    { id: 'desk', name: '云端书桌', em: '☁️' },
    { id: 'bedroom', name: '暖阳卧室', em: '🛏️' },
    { id: 'sakura', name: '樱花草原', em: '🌸' },
    { id: 'moon', name: '月夜城堡', em: '🌙' }
  ];

  function sceneSVG(id, night, thumb) {
    var uid = 'q' + (++uidSeq);
    var P = PALETTES[id][night ? 'night' : 'day'];
    var parts = SCR[id](P, uid, night);
    var dim = '<linearGradient id="' + uid + '_nt" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0a1226" stop-opacity=".42"/>' +
      '<stop offset=".55" stop-color="#0a1226" stop-opacity=".10"/>' +
      '<stop offset="1" stop-color="#0a1226" stop-opacity="0"/></linearGradient>';
    var body = parts[1] + (night ? '<rect width="800" height="560" fill="url(#' + uid + '_nt)"/>' : '');
    var vb = thumb ? '0 246 800 272' : '0 0 800 560';
    return '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' + parts[0] + dim + '</defs>' + body + '</svg>';
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
    var n = (kind === 'sakura') ? 16 : (state.night ? 12 : 10);
    var cls = (kind === 'sakura') ? 'petal' : 'petal mote';
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = cls;
      var size = (kind === 'sakura' ? 6 : 4) + Math.random() * 5;
      s.style.cssText = 'left:' + (Math.random() * 96).toFixed(1) + '%;' +
        'width:' + size.toFixed(1) + 'px;height:' + (kind === 'sakura' ? size * 0.8 : size).toFixed(1) + 'px;' +
        'animation-duration:' + (7 + Math.random() * 8).toFixed(1) + 's;' +
        'animation-delay:-' + (Math.random() * 10).toFixed(1) + 's;' +
        'opacity:0;';
      if (kind === 'sakura') {
        s.style.background = 'rgba(255,' + (160 + Math.round(Math.random() * 40)) + ',' + (190 + Math.round(Math.random() * 30)) + ',.9)';
      }
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

  function petReply(userText) {
    var p = pet();
    var pool = [p.quote, '嗯嗯，我在听～', '你今天回来得比星星还早。', '刚刚有一粒光落在你肩膀上了，看到了吗？',
      '要是累了，就坐一会儿，我不吵你。', '我把今天攒的开心分你一半。'];
    var t = String(userText || '');
    if (/吃|饿/.test(t)) pool = ['小饼干可以吗？只吃一块…', '我不挑的，你给什么我都喜欢。'];
    else if (/睡|累|困/.test(t)) pool = ['那我陪你安静一会儿，眼睛闭一下就好。', '睡吧，我守着。'];
    else if (/你好|在吗|hi|hello/i.test(t)) pool = ['在的，一直都在。', '你终于来啦。'];
    else if (/走|玩|出去/.test(t)) pool = ['走走走！我要走在你前面一点点。', '去哪都行，只要跟你一起。'];
    var text = pool[Math.floor(Math.random() * pool.length)];
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

  $('#segTime').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) setNight(b.dataset.t === 'night');
  });

  $('#btnTime').addEventListener('click', function () { setNight(!state.night); });
  $('#btnSwitch').addEventListener('click', function () { switchPet(1); });

  document.addEventListener('click', function (e) {
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
