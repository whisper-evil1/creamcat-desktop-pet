/* 星穹展厅 —— 星空下的宠物展示台
 *
 * 结构：
 *   makeStars()   程序化星空（三层视差 + 银河带 + 闪烁 shader）
 *   makeHall()    展台（圆盘 + 符文 + 光柱 + 漂浮星屑）
 *   makePet()     宠物（billboard 立绘 + 背光 + 地面辉光 + 落影）
 *   交互：拖动旋转展台（带惯性）/ 滚轮缩放 / 12345 或点击头像切换 / 双击打招呼
 */
(function () {
  'use strict';

  var DATA = window.PET_DATA || [];
  if (!DATA.length) {
    document.querySelector('.loader-text').textContent = '没有找到宠物数据';
    return;
  }

  // ---------- 常量 ----------
  var PED_TOP = 0.18;        // 展台台面高度
  var PET_SIZE = 1.98;       // 立绘平面边长
  var IDLE_SPIN = 0.062;     // 空闲自转速度 rad/s
  var CAM_MIN = 3.9, CAM_MAX = 6.6, CAM_START = 5.05;

  // ---------- 基础三件套 ----------
  var canvas = document.getElementById('stage');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x03040c, 1);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060f, 0.018);

  var camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 1.50, CAM_START);
  camera.lookAt(0, 0.90, 0);

  var clock = new THREE.Clock();
  var t = 0;

  // ---------- 程序化贴图 ----------
  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function tex(c) {
    var x = new THREE.CanvasTexture(c);
    x.anisotropy = 4;
    if (THREE.sRGBEncoding !== undefined) x.encoding = THREE.sRGBEncoding;
    return x;
  }

  // 圆形柔光点
  function dotTexture() {
    var c = cv(128, 128), g = c.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.22, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.26)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return tex(c);
  }

  // 大范围柔光（背光/地面辉光）
  function glowTexture() {
    var c = cv(256, 256), g = c.getContext('2d');
    var grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.28, 'rgba(255,255,255,0.34)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    return tex(c);
  }

  // 椭圆落影
  function shadowTexture() {
    var c = cv(256, 128), g = c.getContext('2d');
    g.save();
    g.translate(128, 64);
    g.scale(1, 0.5);
    var grd = g.createRadialGradient(0, 0, 0, 0, 0, 124);
    grd.addColorStop(0, 'rgba(0,0,0,0.62)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, 124, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return tex(c);
  }

  // 台面符文：双外环 + 刻度 + 辐条 + 菱形标记（不对称，方便看出旋转）
  function runeTexture() {
    var S = 1024, c = cv(S, S), g = c.getContext('2d');
    var R = S / 2;
    g.translate(R, R);
    g.strokeStyle = 'rgba(206,232,255,0.95)';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(150,200,255,1)';
    g.shadowBlur = 18;

    function ring(r, w, a) {
      g.globalAlpha = a;
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }

    ring(R * 0.985, 6, 0.95);
    ring(R * 0.925, 2.5, 0.7);

    // 24 格刻度
    for (var i = 0; i < 24; i++) {
      var a = i * Math.PI / 12;
      var big = i % 6 === 0;
      g.globalAlpha = big ? 0.9 : 0.45;
      g.lineWidth = big ? 5 : 2.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.925, Math.sin(a) * R * 0.925);
      g.lineTo(Math.cos(a) * R * (big ? 0.825 : 0.865), Math.sin(a) * R * (big ? 0.825 : 0.865));
      g.stroke();
    }

    // 辐条（12 根，长短交替）
    for (var j = 0; j < 12; j++) {
      var b = j * Math.PI / 6 + Math.PI / 12;
      g.globalAlpha = 0.36;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(Math.cos(b) * R * 0.80, Math.sin(b) * R * 0.80);
      g.lineTo(Math.cos(b) * R * (j % 2 ? 0.70 : 0.62), Math.sin(b) * R * (j % 2 ? 0.70 : 0.62));
      g.stroke();
    }

    ring(R * 0.60, 3, 0.55);

    // 内圈四段弧（留缺口）
    for (var k = 0; k < 4; k++) {
      var a0 = k * Math.PI / 2 + 0.22;
      g.globalAlpha = 0.8;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(0, 0, R * 0.48, a0, a0 + Math.PI / 2 - 0.44);
      g.stroke();
    }

    // 四个大菱形（0/90/180/270，转向时最直观）
    for (var m = 0; m < 4; m++) {
      var am = m * Math.PI / 2;
      g.save();
      g.translate(Math.cos(am) * R * 0.87, Math.sin(am) * R * 0.87);
      g.rotate(am);
      g.globalAlpha = m === 0 ? 1 : 0.8;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, -26); g.lineTo(26, 0); g.lineTo(0, 26); g.lineTo(-26, 0);
      g.closePath();
      g.stroke();
      g.restore();
    }

    // 中央菱形
    g.globalAlpha = 0.7;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -R * 0.2); g.lineTo(R * 0.2, 0); g.lineTo(0, R * 0.2); g.lineTo(-R * 0.2, 0);
    g.closePath();
    g.stroke();

    return tex(c);
  }

  // 台面石质：中心暗、边缘略亮，带细颗粒与几道磨损
  function stoneTexture() {
    var S = 512, c = cv(S, S), g = c.getContext('2d');
    var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, '#0b1020');
    grd.addColorStop(0.55, '#101728');
    grd.addColorStop(0.86, '#1a2438');
    grd.addColorStop(1, '#0d1422');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);

    var img = g.getImageData(0, 0, S, S), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.2;
    }
    g.putImageData(img, 0, 0);

    g.strokeStyle = 'rgba(150,180,220,0.05)';
    g.lineWidth = 2;
    for (var k = 0; k < 7; k++) {
      g.beginPath();
      var r = 60 + Math.random() * 190;
      var a0 = Math.random() * Math.PI * 2;
      g.arc(S / 2, S / 2, r, a0, a0 + 0.3 + Math.random() * 0.9);
      g.stroke();
    }
    return tex(c);
  }

  // 台面压暗：中心暗、靠近边缘才亮，避免整块像塑料盘
  function floorVignette() {
    var S = 512, c = cv(S, S), g = c.getContext('2d');
    var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(2,4,10,0.86)');
    grd.addColorStop(0.45, 'rgba(2,4,10,0.72)');
    grd.addColorStop(0.78, 'rgba(2,4,10,0.34)');
    grd.addColorStop(0.94, 'rgba(2,4,10,0.06)');
    grd.addColorStop(1, 'rgba(2,4,10,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.fill();
    return tex(c);
  }

  // 环状辉光（台外光圈）
  function ringTexture() {
    var c = cv(512, 512), g = c.getContext('2d');
    var grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0.02)');
    grd.addColorStop(0.60, 'rgba(255,255,255,0.30)');
    grd.addColorStop(0.66, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.74, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(256, 256, 256, 0, Math.PI * 2);
    g.fill();
    return tex(c);
  }

  // 光柱：底部亮、向上淡出
  function beamTexture() {
    var c = cv(256, 512), g = c.getContext('2d');
    var grd = g.createLinearGradient(0, 512, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.22)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    // 横向也做个渐隐
    var mask = g.createLinearGradient(0, 0, 256, 0);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(0.5, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillRect(0, 0, 256, 512);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = mask;
    g.fillRect(0, 0, 256, 512);
    return tex(c);
  }

  // 流星拖尾
  function streakTexture() {
    var c = cv(256, 32), g = c.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.92, 'rgba(255,255,255,0.95)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 12, 256, 8);
    return tex(c);
  }

  // 星云：几团柔光 + 一条银河带
  function nebulaTexture() {
    var S = 1024, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, S, S);

    var blobs = [
      [0.30, 0.34, 0.46, 'rgba(74,86,190,0.55)'],
      [0.72, 0.28, 0.38, 'rgba(120,72,180,0.42)'],
      [0.56, 0.62, 0.44, 'rgba(40,110,180,0.40)'],
      [0.18, 0.72, 0.34, 'rgba(28,74,120,0.42)'],
      [0.86, 0.66, 0.30, 'rgba(96,60,140,0.35)'],
      [0.50, 0.46, 0.50, 'rgba(60,90,160,0.22)']
    ];
    g.filter = 'blur(58px)';
    blobs.forEach(function (b) {
      var grd = g.createRadialGradient(b[0] * S, b[1] * S, 0, b[0] * S, b[1] * S, b[2] * S);
      grd.addColorStop(0, b[3]);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(b[0] * S, b[1] * S, b[2] * S, 0, Math.PI * 2);
      g.fill();
    });

    // 银河带
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-0.42);
    g.scale(1, 0.16);
    var mg = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.62);
    mg.addColorStop(0, 'rgba(180,200,255,0.34)');
    mg.addColorStop(0.45, 'rgba(120,140,220,0.16)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mg;
    g.beginPath();
    g.arc(0, 0, S * 0.62, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.filter = 'none';
    return tex(c);
  }

  var TEX = {
    dot: dotTexture(),
    glow: glowTexture(),
    shadow: shadowTexture(),
    rune: runeTexture(),
    beam: beamTexture(),
    ring: ringTexture(),
    stone: stoneTexture(),
    vig: floorVignette(),
    streak: streakTexture(),
    nebula: nebulaTexture()
  };

  // ---------- 星空 ----------

  var starMaterial = function (sizeScale, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: renderer.getPixelRatio() },
        uSize: { value: sizeScale },
        uOpacity: { value: opacity }
      },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aPhase;',
        'attribute vec3 aColor;',
        'uniform float uTime;',
        'uniform float uPixel;',
        'uniform float uSize;',
        'varying float vAlpha;',
        'varying vec3 vColor;',
        'void main() {',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  float tw = 0.5 + 0.5 * sin(uTime * 1.7 + aPhase);',
        '  vAlpha = 0.28 + 0.72 * tw;',
        '  vColor = aColor;',
        '  gl_PointSize = aSize * uSize * uPixel * (240.0 / max(0.001, -mv.z)) * (0.72 + 0.42 * tw);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'varying float vAlpha;',
        'varying vec3 vColor;',
        'void main() {',
        '  vec2 d = gl_PointCoord - vec2(0.5);',
        '  float r = length(d);',
        '  if (r > 0.5) discard;',
        '  float a = smoothstep(0.5, 0.0, r);',
        '  a = pow(a, 2.0);',
        '  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  };

  var STAR_COLORS = [
    [1.0, 0.98, 0.94],
    [0.82, 0.90, 1.0],
    [0.70, 0.82, 1.0],
    [1.0, 0.92, 0.78],
    [1.0, 0.86, 0.90]
  ];

  function makeStars(count, rMin, rMax, sMin, sMax, opacity, flat) {
    var pos = new Float32Array(count * 3);
    var size = new Float32Array(count);
    var phase = new Float32Array(count);
    var col = new Float32Array(count * 3);

    for (var i = 0; i < count; i++) {
      var u = Math.random() * Math.PI * 2;
      var v = Math.acos(2 * Math.random() - 1);
      var r = rMin + Math.random() * (rMax - rMin);
      var x = Math.sin(v) * Math.cos(u) * r;
      var y = Math.cos(v) * r;
      var z = Math.sin(v) * Math.sin(u) * r;
      if (flat) y *= 0.22;                      // 压扁成银河带
      pos[i * 3] = x;
      pos[i * 3 + 1] = y * 0.72 + 1.4;
      pos[i * 3 + 2] = z;
      size[i] = sMin + Math.random() * (sMax - sMin);
      phase[i] = Math.random() * Math.PI * 2;
      var c = STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));

    var mat = starMaterial(1, opacity);
    var pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return { points: pts, material: mat };
  }

  var starsFar = makeStars(1500, 22, 46, 0.55, 1.8, 0.85, false);
  var starsMid = makeStars(900, 10, 20, 0.9, 2.6, 0.95, false);
  var starsBand = makeStars(1400, 16, 52, 0.5, 1.6, 0.55, true);
  var starsNear = makeStars(64, 5.4, 9.5, 1.8, 4.2, 0.34, false);

  // 星云
  var nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46),
    new THREE.MeshBasicMaterial({
      map: TEX.nebula, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    })
  );
  nebula.position.set(0, 2.4, -22);
  nebula.renderOrder = -10;
  scene.add(nebula);

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0x2a3357, 0.24));

  var key = new THREE.DirectionalLight(0xfff0d8, 0.42);
  key.position.set(2.4, 4.2, 3.2);
  scene.add(key);

  var rim = new THREE.DirectionalLight(0x7fb6ff, 0.58);
  rim.position.set(-3.2, 1.6, -2.4);
  scene.add(rim);

  var under = new THREE.PointLight(0x5f8dff, 0.8, 5, 2);
  under.position.set(0, 0.06, 0);
  scene.add(under);

  // ---------- 展台 ----------
  var turntable = new THREE.Group();
  scene.add(turntable);

  var baseMat = new THREE.MeshStandardMaterial({
    map: TEX.stone, color: 0xffffff, metalness: 0.12, roughness: 0.78,
    emissive: 0x060a18, emissiveIntensity: 0.5
  });
  // 侧壁单独一个更暗的材质，否则台子像一块发光的玻璃砖
  var sideMat = new THREE.MeshStandardMaterial({
    color: 0x070a12, metalness: 0.2, roughness: 0.9,
    emissive: 0x04070f, emissiveIntensity: 0.4
  });
  var base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.02, 1.14, PED_TOP, 96, 1),
    [sideMat, baseMat, sideMat]
  );
  base.position.y = PED_TOP / 2;
  turntable.add(base);

  var runeMat = new THREE.MeshBasicMaterial({
    map: TEX.rune, transparent: true, opacity: 1.0, color: 0xb6dcff,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var runes = new THREE.Mesh(new THREE.CircleGeometry(1.01, 96), runeMat);
  runes.rotation.x = -Math.PI / 2;
  runes.position.y = PED_TOP + 0.005;
  runes.renderOrder = 2;
  turntable.add(runes);

  // 压暗层：盖在符文下面，让台心暗下去、台沿留光
  var vig = new THREE.Mesh(
    new THREE.CircleGeometry(1.01, 96),
    new THREE.MeshBasicMaterial({
      map: TEX.vig, transparent: true, depthWrite: false, opacity: 1
    })
  );
  vig.rotation.x = -Math.PI / 2;
  vig.position.y = PED_TOP + 0.002;
  vig.renderOrder = 1;
  turntable.add(vig);

  var edge = new THREE.Mesh(
    new THREE.TorusGeometry(1.075, 0.006, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.55 })
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = PED_TOP;
  turntable.add(edge);

  // 台外一圈光晕
  var haloMat = new THREE.MeshBasicMaterial({
    map: TEX.ring, transparent: true, opacity: 0.5, color: 0x6fa8ff,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var halo = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = PED_TOP + 0.002;
  halo.renderOrder = 2;
  turntable.add(halo);

  // 光的立柱
  var beamMat = new THREE.MeshBasicMaterial({
    map: TEX.beam, transparent: true, opacity: 0.16, color: 0x9cc4ff,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var beam = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.6), beamMat);
  beam.position.set(0, PED_TOP + 1.8, -0.55);
  beam.renderOrder = 1;
  turntable.add(beam);

  // 漂浮星屑（给展台一点体积感，随旋转一起转）
  var shards = [];
  var shardGeo = new THREE.PlaneGeometry(0.055, 0.055);
  var shardMat = new THREE.MeshBasicMaterial({
    map: TEX.dot, transparent: true, opacity: 0.75, color: 0xffe0a8,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  for (var i = 0; i < 26; i++) {
    var m = new THREE.Mesh(shardGeo, shardMat.clone());
    var ang = Math.random() * Math.PI * 2;
    var rad = 1.2 + Math.random() * 1.35;
    m.position.set(Math.cos(ang) * rad, 0.15 + Math.random() * 1.9, Math.sin(ang) * rad);
    m.userData = {
      ang: ang, rad: rad, y: m.position.y,
      speed: 0.12 + Math.random() * 0.2,
      bob: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 1.4
    };
    m.scale.setScalar(m.userData.s);
    shards.push(m);
    turntable.add(m);
  }

  // ---------- 宠物 ----------
  var petGroup = new THREE.Group();
  petGroup.position.y = PED_TOP - 0.012;
  scene.add(petGroup);

  // 两层平面：A 显示当前朝向，B 在两张朝向之间做交叉淡入
  var petMatA = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false
  });
  var petMatB = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0
  });
  var petGeo = new THREE.PlaneGeometry(PET_SIZE, PET_SIZE);
  var pet = new THREE.Mesh(petGeo, petMatA);
  pet.position.y = PET_SIZE / 2;
  pet.renderOrder = 10;
  petGroup.add(pet);

  var petB = new THREE.Mesh(petGeo, petMatB);
  petB.position.y = PET_SIZE / 2;
  petB.renderOrder = 11;
  petGroup.add(petB);

  // 朝向：0=正面 1=右前45 2=右侧 3=右后135 4=背面，5~7 用镜像补左半边
  var VIEW_STEP = Math.PI / 4;
  var viewTex = DATA.map(function (p) {
    return (p.views || [p.texture]).map(function (uri) {
      var tx = new THREE.Texture();
      if (THREE.sRGBEncoding !== undefined) tx.encoding = THREE.sRGBEncoding;
      var img = new Image();
      img.onload = function () { tx.image = img; tx.needsUpdate = true; };
      img.src = uri;
      return tx;
    });
  });

  var mirrorCache = {};
  function mirrorTex(tx) {
    var key = tx.uuid;
    if (!mirrorCache[key]) {
      var m = tx.clone();
      m.wrapS = THREE.RepeatWrapping;
      m.repeat.x = -1;
      m.offset.x = 1;
      m.needsUpdate = true;
      mirrorCache[key] = m;
    }
    return mirrorCache[key];
  }

  function viewTexture(petIdx, dir) {
    var arr = viewTex[petIdx] || [];
    if (!arr.length) return null;
    var d = ((dir % 8) + 8) % 8;
    if (d <= 4) return arr[Math.min(d, arr.length - 1)];
    return mirrorTex(arr[Math.min(8 - d, arr.length - 1)]);
  }

  // 地面倒影：把立绘上下翻转并做自上而下的 alpha 渐隐，铺在台面上
  var reflMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.26, depthWrite: false, depthTest: false, toneMapped: false
  });
  var petRefl = new THREE.Mesh(new THREE.PlaneGeometry(PET_SIZE, PET_SIZE), reflMat);
  petRefl.position.y = -PET_SIZE / 2 * 0.42;
  petRefl.renderOrder = 4;
  petGroup.add(petRefl);

  function reflectionTexture(img) {
    var S = 512, c = cv(S, S), g = c.getContext('2d');
    g.save();
    g.translate(0, S);
    g.scale(1, -1);
    g.drawImage(img, 0, 0, S, S);
    g.restore();
    // 翻转后「脚」在贴图顶部：顶部保留，越往下越淡
    g.globalCompositeOperation = 'destination-in';
    var grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.35)');
    grd.addColorStop(0.72, 'rgba(0,0,0,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return tex(c);
  }

  // 背光
  var backGlowMat = new THREE.MeshBasicMaterial({
    map: TEX.glow, transparent: true, opacity: 0.42, color: 0x8fb4ff,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var backGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.1), backGlowMat);
  backGlow.position.set(0, PET_SIZE * 0.52, -0.35);
  backGlow.renderOrder = 5;
  petGroup.add(backGlow);

  // 落影
  var shadowMat = new THREE.MeshBasicMaterial({
    map: TEX.shadow, transparent: true, opacity: 0.55, color: 0x000000,
    depthWrite: false
  });
  var shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(0, 0.004, 0.02);
  shadowMesh.scale.set(1, 0.42, 1);
  shadowMesh.renderOrder = 3;
  petGroup.add(shadowMesh);

  // ---------- 流星 ----------
  var meteors = [];
  for (var k = 0; k < 2; k++) {
    var mMat = new THREE.MeshBasicMaterial({
      map: TEX.streak, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), mMat);
    mesh.renderOrder = -5;
    scene.add(mesh);
    meteors.push({ mesh: mesh, mat: mMat, t: -1, next: 2 + Math.random() * 5, dur: 1.1 });
  }

  function launchMeteor(mo) {
    var dir = Math.random() > 0.5 ? 1 : -1;
    var x0 = dir * (12 + Math.random() * 10);
    var y0 = 7 + Math.random() * 6;
    var z = -14 - Math.random() * 12;
    mo.mesh.position.set(x0, y0, z);
    mo.mesh.rotation.z = dir > 0 ? -0.62 : -Math.PI + 0.62;
    mo.t = 0;
    mo.dur = 0.9 + Math.random() * 0.7;
    mo.vx = -dir * (11 + Math.random() * 8);
    mo.vy = -(6 + Math.random() * 5);
  }

  // ---------- 状态 ----------
  var state = {
    index: 0,
    spin: 0,
    spinVel: 0,
    dragging: false,
    lastX: 0,
    lastT: 0,
    camDist: CAM_START,
    camTarget: CAM_START,
    phase: 'idle',       // idle | out | in
    phaseT: 0,
    hop: 0,
    hopV: 0,
    scale: 1,
    curA: -1,
    curDir: -1,
    preset: null
  };

  // 倒影：按「宠物 + 朝向」缓存，转身时才重做一张
  var reflCache = {};
  var reflDir = -1;

  function refreshReflection(petIdx, dir) {
    var key = petIdx + '|' + dir;
    var img = null;
    var tx = viewTexture(petIdx, dir);
    if (!tx || !tx.image) return;
    if (reflCache[key]) {
      reflMat.map = reflCache[key];
      reflMat.needsUpdate = true;
      return;
    }
    img = tx.image;
    var made = reflectionTexture(img);
    if (THREE.sRGBEncoding !== undefined) made.encoding = THREE.sRGBEncoding;
    reflCache[key] = made;
    reflMat.map = made;
    reflMat.needsUpdate = true;
  }

  // ---------- UI ----------
  var el = {
    plate: document.getElementById('plate'),
    name: document.getElementById('pName'),
    en: document.getElementById('pEn'),
    desc: document.getElementById('pDesc'),
    quote: document.getElementById('pQuote'),
    element: document.getElementById('pElement'),
    dot: document.getElementById('pDot'),
    tags: document.getElementById('pTags'),
    idx: document.getElementById('idxNo'),
    total: document.getElementById('totalNo'),
    rail: document.getElementById('rail'),
    bubble: document.getElementById('bubble'),
    bubbleText: document.getElementById('bubbleText'),
    loader: document.getElementById('loader')
  };

  el.total.textContent = String(DATA.length).padStart(2, '0');

  DATA.forEach(function (p, i) {
    var b = document.createElement('button');
    b.className = 'pet-btn' + (i === 0 ? ' on' : '');
    b.type = 'button';
    b.dataset.name = p.name;
    b.style.backgroundImage = 'url(' + p.texture + ')';
    b.addEventListener('click', function () { select(i); });
    el.rail.appendChild(b);
  });

  function paintPanel(p) {
    document.documentElement.style.setProperty('--accent', p.accent);
    el.name.textContent = p.name;
    el.en.textContent = p.en;
    el.desc.textContent = p.desc;
    el.quote.textContent = '「' + p.quote + '」';
    el.element.textContent = p.element;
    el.idx.textContent = p.no;
    el.tags.innerHTML = '';
    (p.tags || []).forEach(function (tag) {
      var li = document.createElement('li');
      li.textContent = tag;
      el.tags.appendChild(li);
    });
  }

  function select(i, instant) {
    if (i === state.index && !instant) return;
    state.index = i;
    var p = DATA[i];
    Array.prototype.forEach.call(el.rail.children, function (b, j) {
      b.classList.toggle('on', j === i);
    });
    // 展签先淡出再换字
    el.plate.classList.add('fade');
    setTimeout(function () {
      paintPanel(p);
      el.plate.classList.remove('fade');
    }, 150);

    if (instant) {
      petMatA.opacity = 1;
      state.phase = 'idle';
      state.curDir = -1;            // 强制下一帧重新贴当前朝向
      state.curA = -1;
    } else {
      state.phase = 'out';
      state.phaseT = 0;
      state.curA = -1;
    }
    hideBubble();
  }

  // ---------- 气泡 ----------
  var bubbleTimer = 0;

  function projectPet(topOffset) {
    var v = new THREE.Vector3(0, PET_SIZE * topOffset + PED_TOP, 0);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  function showBubble(text) {
    var p = projectPet(0.92);
    el.bubbleText.textContent = text;
    el.bubble.classList.add('show');
    // 先显示再量，避免宽度为 0
    var w = el.bubble.offsetWidth;
    var x = Math.min(Math.max(p.x, w / 2 + 16), window.innerWidth - w / 2 - 16);
    el.bubble.style.left = x + 'px';
    el.bubble.style.top = (p.y - 18) + 'px';
    bubbleTimer = 3.4;
  }

  function hideBubble() {
    el.bubble.classList.remove('show');
    bubbleTimer = 0;
  }

  function poke() {
    state.hopV = 3.1;
    var p = DATA[state.index];
    showBubble(p.quote);
  }

  // ---------- 交互 ----------
  var lastInteract = 0;

  canvas.addEventListener('pointerdown', function (e) {
    state.dragging = true;
    state.lastX = e.clientX;
    state.lastT = performance.now();
    state.spinVel = 0;
    document.body.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    lastInteract = t;
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!state.dragging) return;
    var now = performance.now();
    var dx = e.clientX - state.lastX;
    var dtm = Math.max(8, now - state.lastT) / 1000;
    state.spin += dx * 0.0082;
    state.spinVel = THREE.MathUtils.clamp(dx * 0.0082 / dtm, -3.4, 3.4);
    state.lastX = e.clientX;
    state.lastT = now;
    lastInteract = t;
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    document.body.classList.remove('dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    lastInteract = t;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    state.camTarget = THREE.MathUtils.clamp(
      state.camTarget + e.deltaY * 0.0016, CAM_MIN, CAM_MAX
    );
  }, { passive: false });

  canvas.addEventListener('dblclick', function () { poke(); });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      state.spin -= 0.32; lastInteract = t;
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      state.spin += 0.32; lastInteract = t;
    } else if (e.key === ' ' || e.key === 'Enter') {
      poke();
    } else if (/^[1-9]$/.test(e.key)) {
      var n = parseInt(e.key, 10) - 1;
      if (n < DATA.length) select(n);
    }
  });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    [starsFar, starsMid, starsBand, starsNear].forEach(function (s) {
      s.material.uniforms.uPixel.value = renderer.getPixelRatio();
    });
  });

  // ---------- 主循环 ----------
  var petBaseY = 0;

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (window.__fixedDt) dt = 1 / 60;
    t += dt;

    // 旋转：拖动惯性 + 空闲自转
    if (!state.dragging) {
      state.spin += state.spinVel * dt;
      state.spinVel *= Math.exp(-dt * 2.6);
      if (Math.abs(state.spinVel) < 0.02) state.spinVel = 0;
      var idleFor = t - lastInteract;
      if (idleFor > 4.0) state.spin += IDLE_SPIN * dt * Math.min(1, (idleFor - 4.0) / 2.5);
    }
    turntable.rotation.y = state.spin;

    // 星屑浮动
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i], u = s.userData;
      u.ang += u.speed * dt;
      s.position.x = Math.cos(u.ang) * u.rad;
      s.position.z = Math.sin(u.ang) * u.rad;
      s.position.y = u.y + Math.sin(t * 0.8 + u.bob) * 0.09;
      s.material.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6 + u.bob));
    }

    // 星云缓慢漂移
    nebula.rotation.z = Math.sin(t * 0.02) * 0.04;
    nebula.material.opacity = 0.5 + Math.sin(t * 0.4) * 0.05;

    // 星空视差
    starsFar.points.rotation.y = state.spin * 0.018 + t * 0.004;
    starsMid.points.rotation.y = state.spin * 0.045 + t * 0.006;
    starsBand.points.rotation.y = -state.spin * 0.012 + t * 0.003;
    starsNear.points.rotation.y = state.spin * 0.09;
    [starsFar, starsMid, starsBand, starsNear].forEach(function (s) {
      s.material.uniforms.uTime.value = t;
    });

    // 流光柱呼吸
    beamMat.opacity = 0.12 + Math.sin(t * 1.1) * 0.035;
    haloMat.opacity = 0.46 + Math.sin(t * 0.9 + 1.2) * 0.07;
    edge.material.opacity = 0.45 + Math.sin(t * 1.4) * 0.12;

    // 宠物：呼吸 + 呼吸缩放 + 拖拽时的倾斜
    var breathe = 1 + Math.sin(t * 1.15) * 0.006;
    var baseScale = state.scale;
    var lean = THREE.MathUtils.clamp(state.spinVel * 0.055, -0.18, 0.18);

    // 跳一下（双击打招呼）
    if (state.hopV !== 0 || state.hop !== 0) {
      state.hopV -= 14.5 * dt;
      state.hop += state.hopV * dt;
      if (state.hop <= 0) { state.hop = 0; state.hopV = 0; }
    }

    // 换宠过渡
    if (state.phase === 'out') {
      state.phaseT += dt;
      var k1 = Math.min(1, state.phaseT / 0.16);
      petMatA.opacity = 1 - k1;
      petMatB.opacity = 0;
      state.scale = 1 - 0.05 * k1;
      if (k1 >= 1) {
        state.curA = -1;               // 换宠物后重新贴图
        state.phase = 'in';
        state.phaseT = 0;
      }
    } else if (state.phase === 'in') {
      state.phaseT += dt;
      var k2 = Math.min(1, state.phaseT / 0.34);
      var e = 1 - Math.pow(1 - k2, 3);
      petMatA.opacity = e;
      state.scale = 0.95 + 0.05 * e;
      backGlowMat.opacity = 0.42 + (1 - e) * 0.5;
      if (k2 >= 1) state.phase = 'idle';
    } else {
      backGlowMat.opacity = 0.38 + Math.sin(t * 0.9) * 0.06;
    }

    // —— 朝向：宠物跟着转盘一起转身（0=正面 … 4=背面，5~7 走镜像）——
    var posMod = ((state.spin / VIEW_STEP) % 8 + 8) % 8;
    var i0 = Math.floor(posMod) % 8;
    var frac = posMod - Math.floor(posMod);
    var i1 = (i0 + 1) % 8;
    // 卡在正朝向时保持清晰，靠近下一个朝向时才快速交叉淡入
    var w = frac <= 0.72 ? 0 : (frac - 0.72) / 0.28;
    w = w * w * (3 - 2 * w);

    if (i0 !== state.curA) {
      var txA = viewTexture(state.index, i0);
      if (txA) {
        petMatA.map = txA;
        petMatA.needsUpdate = true;
        refreshReflection(state.index, i0);
      }
      state.curA = i0;
    }
    if (w > 0.002) {
      var txB = viewTexture(state.index, i1);
      if (txB && petMatB.map !== txB) {
        petMatB.map = txB;
        petMatB.needsUpdate = true;
      }
      petMatB.opacity = w * petMatA.opacity;
    } else if (petMatB.opacity !== 0) {
      petMatB.opacity = 0;
    }

    petGroup.position.y = PED_TOP + state.hop;
    petGroup.rotation.z = lean * 0.12;
    pet.scale.set(baseScale, baseScale * breathe, baseScale);
    pet.position.y = PET_SIZE / 2 * baseScale * breathe;
    petB.scale.copy(pet.scale);
    petB.position.copy(pet.position);
    petB.rotation.copy(pet.rotation);
    // 倒影跟着一起缩放/上下，只是方向相反、透明度更低
    // 倒影压扁到 0.42，否则会从台面边缘溢出去，看起来像块玻璃片
    petRefl.scale.set(baseScale, baseScale * breathe * 0.42, baseScale);
    petRefl.position.y = -PET_SIZE / 2 * baseScale * breathe * 0.42;
    reflMat.opacity = 0.34 * petMatA.opacity;
    shadowMesh.material.opacity = 0.55 - state.hop * 1.6;
    shadowMesh.scale.set(1 + state.hop * 0.5, 0.42 + state.hop * 0.2, 1);

    // 相机推拉
    state.camDist += (state.camTarget - state.camDist) * Math.min(1, dt * 6);
    camera.position.z = state.camDist;
    camera.position.y = 1.50 - (state.camDist - CAM_START) * 0.05;
    camera.lookAt(0, 0.90, 0);

    // 流星
    for (var mi = 0; mi < meteors.length; mi++) {
      var mo = meteors[mi];
      if (mo.t < 0) {
        mo.next -= dt;
        if (mo.next <= 0) launchMeteor(mo);
      } else {
        mo.t += dt;
        var k = mo.t / mo.dur;
        mo.mesh.position.x += mo.vx * dt;
        mo.mesh.position.y += mo.vy * dt;
        mo.mat.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.9;
        if (k >= 1) {
          mo.t = -1;
          mo.mat.opacity = 0;
          mo.next = 3 + Math.random() * 6;
        }
      }
    }

    // 气泡跟随
    if (bubbleTimer > 0) {
      bubbleTimer -= dt;
      if (bubbleTimer <= 0) hideBubble();
      else {
        var pp = projectPet(0.92 + state.hop);
        var w2 = el.bubble.offsetWidth;
        var bx = Math.min(Math.max(pp.x, w2 / 2 + 16), window.innerWidth - w2 / 2 - 16);
        el.bubble.style.left = bx + 'px';
        el.bubble.style.top = (pp.y - 18) + 'px';
      }
    }

    if (window.__dbgTitle) document.title = state.phase + '|op=' + petMatA.opacity.toFixed(2) +
      '|idx=' + state.index + '|t=' + t.toFixed(2);
    renderer.render(scene, camera);
  }

  // ---------- 启动 ----------
  // 调试：?dbg=nohalo,norune,nobeam,nobase,noshard
  (function () {
    var q = new URLSearchParams(location.search).get('dbg');
    if (!q) return;
    var set = q.split(',');
    if (set.indexOf('nohalo') >= 0) halo.visible = false;
    if (set.indexOf('norune') >= 0) runes.visible = false;
    if (set.indexOf('nobeam') >= 0) beam.visible = false;
    if (set.indexOf('noshard') >= 0) shards.forEach(function (x) { x.visible = false; });
    if (set.indexOf('nobase') >= 0) { baseMat.color.setHex(0x000000); baseMat.emissive.setHex(0x000000); }
  })();

  // 调试：?pet=2 直接选中第 3 只
  var preset = parseInt(new URLSearchParams(location.search).get('pet') || '0', 10);
  var startIdx = (preset > 0 && preset < DATA.length) ? preset : 0;
  var presetSpin = parseFloat(new URLSearchParams(location.search).get('spin') || '0');
  if (!isNaN(presetSpin)) state.spin = presetSpin;
  var qs = new URLSearchParams(location.search);
  if (qs.get('titledbg')) window.__dbgTitle = 1;
  if (qs.get('fixeddt')) { window.__fixedDt = 1; window.__dbgTitle = 1; }
  select(startIdx, true);

  // 调试：?autoswitch=2 一秒后自动切到第 3 只，验证淡出淡入流程
  var autoSw = parseInt(new URLSearchParams(location.search).get('autoswitch') || '-1', 10);
  if (autoSw >= 0) setTimeout(function () { select(autoSw); }, 900);

  // 贴图是 data URI，解码很快；给一帧的余量再揭牌
  setTimeout(function () {
    el.loader.classList.add('done');
    setTimeout(function () { el.loader.style.display = 'none'; }, 900);
    animate();
  }, 260);
})();
