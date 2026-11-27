/* ===================== 星宠语 · 小窝（2D） =====================
 * 两层画面：
 *   1) 全景 room.webp + 家具热区（悬停发光，点击进入）
 *   2) 近景 scene-*.webp（床 / 猫爬架 / 猫窝 / 桌子 / 书柜 / 窗边）
 * 点击后背景交叉淡入切到近景，宠物淡出、换位、再淡入，最后对话框升起说话。
 * 对话是一个小的意图引擎：识别 -> 结合所在地点回答 -> 给出 3 个接得上的追问。
 */
(function () {
  'use strict';

  var DATA = (window.PET_DATA || []).slice();
  var $ = function (s) { return document.querySelector(s); };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  var stage = $('#stage');
  var world = $('#world');
  var scene = $('#scene');
  var spotsEl = $('#spots');
  var petWrap = $('#petWrap');
  var petIn = $('#petIn');
  var petImg = $('#petImg');
  var petFx = $('#petFx');
  var petShadow = $('#petShadow');
  var hint = $('#hint');

  var cardAva = $('#cardAva');
  var cardName = $('#cardName');
  var cardLv = $('#cardLv');
  var cardMood = $('#cardMood');
  var btnHeart = $('#btnHeart');

  var dialog = $('#dialog');
  var dlgImg = $('#dlgImg');
  var dlgName = $('#dlgName');
  var dlgHere = $('#dlgHere');
  var dlgEcho = $('#dlgEcho');
  var dlgText = $('#dlgText');
  var dlgChips = $('#dlgChips');
  var dlgChat = $('#dlgChat');
  var chatInput = $('#chatInput');
  var btnSend = $('#btnSend');
  var btnChat = $('#btnChat');

  /* ================= 地点 =================
   * x/y/w/h : 全景图上的热区（%）
   * img     : 近景场景图
   * px/py   : 宠物在近景里的落脚点（视口 %，py 是脚底）
   * ph      : 宠物在近景里的高度（vh）
   * pose    : p-sit / p-lie / p-tall
   * fx      : 头顶飘的符号
   */
  var HOME_TALK = {
    doing: ['我在房间里转来转去，看看有没有新东西。', '刚在地毯上打了个滚，地板凉凉的。'],
    look: '整间屋子呀：左边是猫爬架和窗，中间是床和圆桌，右边是我的小屋。',
    like: '因为整间屋子都有你的味道。',
    sleep: '那我去床上躺一会儿…你点一下床就能找到我。',
    play: '好呀，去地毯上追球吧！我跑得很快的。',
    chips: ['这里是什么地方', '你最喜欢哪个地方', '陪我玩一会儿']
  };

  var SPOTS = [
    {
      id: 'tree', name: '猫爬架', here: '猫爬架旁',
      img: 'assets/scene/scene-tree.webp',
      x: 2.4, y: 12.5, w: 13.2, h: 45,
      px: 45, py: 77, ph: 24, pose: 'p-tall', fx: '',
      lines: [
        '哎呀～\n我爬上来了！好高呀！',
        '站在最高的那层，\n整个房间都在我脚下。',
        '（扒着猫抓柱）沙沙沙…\n这个手感超好的。'
      ],
      talk: {
        doing: ['我在猫爬架下面埋伏，等小球晃过来。', '刚爬到第二层，正在考虑要不要跳进圆窝。'],
        look: '这是我的猫爬架，一共三层，最上面那层能看到整间屋子。',
        like: '因为站得高，能第一个看见你进门呀。',
        sleep: '圆窝里睡最舒服了…不过我还想再玩一会儿。',
        play: '要比赛爬架子吗？我让你三层。',
        chips: ['你在做什么呀', '你困不困', '给我讲讲你的事']
      }
    },
    {
      id: 'window', name: '窗边', here: '窗边',
      img: 'assets/scene/scene-window.webp',
      x: 9.8, y: 2.2, w: 23.2, h: 42.5,
      px: 52, py: 74, ph: 24, pose: 'p-sit', fx: '',
      lines: [
        '窗外在飘樱花呢～\n风一吹像下雪一样。',
        '（把爪子搭在窗台上）\n今天的云好像棉花糖。',
        '晒着太阳暖洋洋的…\n有点困了。'
      ],
      talk: {
        doing: ['我在看窗外的樱花，风一吹就下花瓣雨。', '刚把爪子搭在窗台上，光暖暖的。'],
        look: '这是窗户，外面那棵樱花树每年这个时候最漂亮。',
        like: '因为能看见外面，也能看见你从远处走回来。',
        sleep: '晒着太阳就想睡…你也来晒一会儿？',
        play: '玩追光斑吗？地板上的光会跑来跑去。',
        chips: ['给我看看窗外', '这里是什么地方', '你最喜欢哪个地方']
      }
    },
    {
      id: 'shelf', name: '书柜', here: '书柜前',
      img: 'assets/scene/scene-shelf.webp',
      x: 34.8, y: 21.4, w: 14, h: 31.5,
      px: 58, py: 76, ph: 24, pose: 'p-tall', fx: '',
      lines: [
        '好多书呀～\n我也想看看～',
        '这本蓝色的看起来最有趣，\n我用鼻子顶了顶它。',
        '书的味道，\n是纸和阳光混在一起的味道。'
      ],
      talk: {
        doing: ['我在数书脊上的颜色，一本一本数过去。', '刚把头探进第三层，想找那本蓝色的书。'],
        look: '这是书柜，四层，最下面那层是我能够到的高度。',
        like: '因为书里有好多我没去过的地方。',
        sleep: '看书看困了…书柜旁边正好有块小垫子。',
        play: '玩找书游戏吧，你说颜色，我去找。',
        chips: ['给我讲讲你的事', '你为什么喜欢这里', '我摸摸你']
      }
    },
    {
      id: 'bed', name: '床', here: '床边',
      img: 'assets/scene/scene-bed.webp',
      x: 50.4, y: 27.4, w: 27, h: 26.5,
      px: 52, py: 74, ph: 24, pose: 'p-sit', fx: 'Z z z',
      lines: [
        '呼……好舒服呀～\n在床上睡觉真是太幸福了！',
        '被子是格子的，和我很配吧？\n我要在这里滚三圈。',
        '床头灯暖暖的…\n我先躺一小会儿，就一小会儿。'
      ],
      talk: {
        doing: ['我在被子上滚来滚去，格子被子软得像云。', '刚把脑袋埋进枕头里，只露出一只耳朵。'],
        look: '这是床呀，被子前几天刚晒过，闻起来是太阳的味道。',
        like: '因为这里能听见窗外的风声，而且被子是格子的，跟我很配。',
        sleep: '那我先躺下啦…被子给你留一半。',
        play: '在床上玩枕头仗吗？我可厉害了。',
        chips: ['我可以躺一下吗', '你困不困', '你为什么喜欢这里']
      }
    },
    {
      id: 'table', name: '桌子', here: '桌子边',
      img: 'assets/scene/scene-table.webp',
      x: 62.8, y: 55.4, w: 18, h: 18.5,
      px: 52, py: 74, ph: 24, pose: 'p-sit', fx: '',
      lines: [
        '嗯？这是什么呀？\n好像是一本书呢～',
        '牛奶还热着…\n我可以喝一小口吗？',
        '（趴在桌沿上）\n这个高度刚好能看到你。'
      ],
      talk: {
        doing: ['我在桌子边上闻那杯牛奶，还热着。', '刚用鼻子顶了顶那本书，想翻一页。'],
        look: '这是小圆桌，上面有牛奶、一本书，还有一小瓶花。',
        like: '因为这里正好晒得到太阳，喝牛奶刚刚好。',
        sleep: '趴在桌子底下睡…不行，会挡到你走路。',
        play: '那我们把书顶来顶去玩？',
        chips: ['你饿不饿', '这里是什么地方', '陪我玩一会儿']
      }
    },
    {
      id: 'house', name: '猫窝', here: '猫窝门口',
      img: 'assets/scene/scene-house.webp',
      x: 84.6, y: 37.6, w: 14.2, h: 20,
      px: 52, py: 74, ph: 24, pose: 'p-sit', fx: '',
      lines: [
        '这里好温暖～\n还是在猫窝里最舒服啦！',
        '（从门口探出半个头）\n你要不要也进来挤一挤？',
        '我的秘密基地，\n门口那个爪印是我按的哦。'
      ],
      talk: {
        doing: ['我钻进小屋里啦，只把尾巴留在门外面。', '在小屋里整理我的收藏——三根羽毛和一颗纽扣。'],
        look: '这是我的小屋，门口那个猫爪印是我自己按的。',
        like: '因为这里是我的秘密基地，谁也找不到我。',
        sleep: '小屋里面最暖和…我先进去窝着。',
        play: '要不要玩躲猫猫？你数到十。',
        chips: ['我可以躺一下吗', '这里是什么地方', '给我讲讲你的事']
      }
    }
  ];

  /* ================= 状态 ================= */
  var SAVE_KEY = 'xingchongyu.nest.v2';
  var state = {
    idx: 0,
    spot: null,
    mood: 76,
    lv: 5,
    userName: '',
    chatting: false,
    typing: null,
    timer: null,
    lastRule: '',
    ruleHits: {},
    gotoSpot: null,
    fast: /[?&]fast=1/.test(location.search)
  };

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (typeof o.idx === 'number' && DATA[o.idx]) state.idx = o.idx;
      if (typeof o.mood === 'number') state.mood = o.mood;
      if (typeof o.lv === 'number') state.lv = o.lv;
      if (typeof o.userName === 'string') state.userName = o.userName;
    } catch (e) { /* 存档坏了就忽略 */ }
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        idx: state.idx, mood: state.mood, lv: state.lv, userName: state.userName
      }));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function pet() { return DATA[state.idx] || { name: '小宠物', texture: '', quote: '' }; }

  function whereOf() {
    if (!state.spot) return HOME_TALK;
    return state.spot.talk || HOME_TALK;
  }

  function hereOf() { return state.spot ? state.spot.here : '小窝'; }
  function spotOf() { return state.spot ? state.spot.id : 'room'; }

  /* ================= 热区 ================= */
  var spotEls = {};

  function buildSpots() {
    var paw = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<ellipse cx="12" cy="15.6" rx="5.2" ry="4.4" fill="#c58b52"/>' +
      '<ellipse cx="5.4" cy="10.2" rx="2.1" ry="2.6" fill="#c58b52"/>' +
      '<ellipse cx="9.4" cy="6.7" rx="2.1" ry="2.7" fill="#c58b52"/>' +
      '<ellipse cx="14.6" cy="6.7" rx="2.1" ry="2.7" fill="#c58b52"/>' +
      '<ellipse cx="18.6" cy="10.2" rx="2.1" ry="2.6" fill="#c58b52"/></svg>';

    var frag = document.createDocumentFragment();
    SPOTS.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'spot';
      el.style.setProperty('--x', s.x + '%');
      el.style.setProperty('--y', s.y + '%');
      el.style.setProperty('--w', s.w + '%');
      el.style.setProperty('--h', s.h + '%');
      el.dataset.id = s.id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', s.name);
      el.innerHTML = '<span class="tag">' + paw + '<span>' + s.name + '</span></span>';

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        goSpot(s);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goSpot(s); }
      });

      spotEls[s.id] = el;
      frag.appendChild(el);
    });
    spotsEl.appendChild(frag);
  }

  /* ================= 全景盒（让热区百分比 = 图片百分比） ================= */
  var RATIO = 1536 / 818;
  var box = { w: 0, h: 0, x: 0, y: 0 };

  function fitWorld() {
    var vw = stage.clientWidth;
    var vh = stage.clientHeight;
    var w = vw, h = vw / RATIO;
    if (h < vh) { h = vh; w = vh * RATIO; }

    box.w = w; box.h = h;
    box.x = (vw - w) / 2;
    box.y = (vh - h) / 2;

    world.style.width = Math.round(w) + 'px';
    world.style.height = Math.round(h) + 'px';
    world.style.left = Math.round(box.x) + 'px';
    world.style.top = Math.round(box.y) + 'px';
  }

  /* ================= 宠物位置 ================= */
  function setPet(px, py, ph, pose, noAnim) {
    petWrap.classList.toggle('snap', !!noAnim);
    petWrap.style.setProperty('--px', px + '%');
    petWrap.style.setProperty('--py', py + '%');
    petWrap.style.setProperty('--ph', ph + 'vh');
    petShadow.style.setProperty('--px', px + '%');
    petShadow.style.setProperty('--py', py + '%');

    petWrap.classList.remove('p-sit', 'p-lie', 'p-tall');
    if (pose) petWrap.classList.add(pose);

    if (noAnim) {
      void petWrap.offsetWidth;
      setTimeout(function () { petWrap.classList.remove('snap'); }, 40);
    }
  }

  function setFx(txt) {
    petFx.textContent = txt || '';
    petFx.classList.remove('on');
    if (!txt) return;
    void petFx.offsetWidth;
    petFx.classList.add('on');
  }

  function hop() {
    petWrap.classList.remove('hop');
    void petWrap.offsetWidth;
    petWrap.classList.add('hop');
    setTimeout(function () { petWrap.classList.remove('hop'); }, 700);
  }

  /* ================= 切场景 ================= */
  var navToken = 0;

  function goSpot(s) {
    var token = ++navToken;
    var same = state.spot && state.spot.id === s.id;
    state.spot = s;
    stage.classList.add('zoomed');
    hideHint();

    // 背景：先把近景图换上再淡入，形成交叉淡化
    scene.style.backgroundImage = 'url("' + s.img + '")';
    scene.classList.remove('on');
    void scene.offsetWidth;
    scene.classList.add('on');

    // 宠物：淡出 -> 换位置 -> 淡入
    petWrap.classList.add('ghost');
    petShadow.classList.add('ghost');
    setFx('');

    setTimeout(function () {
      if (token !== navToken) return;
      setPet(s.px, s.py, s.ph, s.pose, true);
      hop();
      petWrap.classList.remove('ghost');
      petShadow.classList.remove('ghost');
    }, same ? 60 : 240);

    setTimeout(function () { if (token === navToken) setFx(s.fx); }, 420);

    // 对话框：先收起，再带着台词升起
    closeDialog();
    setTimeout(function () {
      if (token !== navToken) return;
      dlgHere.textContent = '· ' + s.here;
      dlgEcho.classList.remove('on');
      openDialog();
      say(pick(s.lines), true);
      setChips(s.talk.chips);
    }, same ? 90 : 460);

    state.mood = Math.min(100, state.mood + 2);
    renderCard();
    save();
  }

  function reset() {
    if (!state.spot) { closeDialog(); return; }
    var token = ++navToken;
    state.spot = null;
    stage.classList.remove('zoomed');
    scene.classList.remove('on');
    setFx('');

    petWrap.classList.add('ghost');
    petShadow.classList.add('ghost');
    setTimeout(function () {
      if (token !== navToken) return;
      setPet(50, 76, 21, '', true);
      hop();
      petWrap.classList.remove('ghost');
      petShadow.classList.remove('ghost');
    }, 200);

    closeDialog();
    setTimeout(function () {
      if (token !== navToken) return;
      dlgHere.textContent = '· 小窝';
      dlgEcho.classList.remove('on');
      openDialog();
      say(pick([
        '回来啦～\n接下来想去哪里看看？',
        '（跟在你脚边）\n还想再逛一圈吗？'
      ]), true);
      setChips(HOME_TALK.chips);
    }, 420);
  }

  /* ================= 对话框 ================= */
  function openDialog() { dialog.classList.add('show'); }

  function closeDialog() {
    dialog.classList.remove('show');
    stopTyping();
  }

  function stopTyping() {
    if (state.typing) { clearTimeout(state.typing); state.typing = null; }
  }

  function say(text) {
    stopTyping();
    dlgText.classList.remove('thinking');
    dlgText.textContent = '';
    if (!text) return;

    if (state.fast) { dlgText.textContent = text; return; }

    var i = 0;

    (function step() {
      if (i >= text.length) { dlgText.textContent = text; state.typing = null; return; }
      var ch = text.charAt(i);
      i++;
      dlgText.textContent = text.slice(0, i);

      // 标点后停一下，读起来更像人在说话
      var pause = 24;
      if ('。！？～…'.indexOf(ch) >= 0) pause = 180;
      else if ('，、'.indexOf(ch) >= 0) pause = 95;
      else if (ch === '\n') pause = 150;

      state.typing = setTimeout(step, pause);
    })();
  }

  function setChips(list) {
    dlgChips.innerHTML = '';
    (list || []).slice(0, 3).forEach(function (txt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        userSay(txt);
      });
      dlgChips.appendChild(b);
    });
  }

  /* ================= 对话引擎 ================= */
  function ctx(raw) {
    return {
      raw: raw || '',
      spot: spotOf(),
      here: hereOf(),
      name: pet().name,
      user: state.userName,
      mood: state.mood,
      where: whereOf()
    };
  }

  var RULES = [
    /* ---- 自我介绍 / 记忆 ---- */
    {
      id: 'setname', k: ['我叫', '我是', '叫我'],
      say: function (c) {
        var m = c.raw.match(/我(?:叫|是)\s*([^\s，,。！!？?、]{1,8})/) || c.raw.match(/叫我\s*([^\s，,。！!？?、]{1,8})/);
        if (!m) return '嗯？你叫什么呀，我没听清。';
        state.userName = m[1];
        save();
        return '「' + m[1] + '」…真好听。\n以后我就这么叫你啦，' + m[1] + '。';
      },
      chips: function () { return ['你记住了吗', '你饿不饿', '陪我玩一会儿']; }
    },
    {
      id: 'name', k: ['名字', '你是谁', '叫什么'],
      say: function (c) { return '我叫' + c.name + '呀，住在这间屋子里。\n你怎么称呼？'; },
      chips: function () { return ['我叫…', '你几岁啦', '你住在这里吗']; }
    },
    {
      id: 'remember', k: ['记住'],
      say: function (c) {
        return c.user ? '记住啦，' + c.user + '。\n我把你的名字放在最里面的那格。' : '记住啦，写在心里的那种。';
      },
      chips: function () { return ['你真好', '你饿不饿', '陪我玩一会儿']; }
    },
    {
      id: 'age', k: ['几岁', '多大', '年龄'],
      say: function () { return '按你们的算法…大概三岁？\n不过我不太在意这个。'; },
      chips: function () { return ['那你几岁啦', '你住在这里吗', '陪我玩一会儿']; }
    },
    {
      id: 'home', k: ['住在这里', '你的家', '家住', '住哪'],
      say: function (c) { return '嗯！这间屋子就是我的家。\n你点一下家具，我就带你去看。'; },
      chips: function (c) { return c.where.chips; }
    },

    /* ---- 地点 ---- */
    {
      id: 'fav', k: ['喜欢哪个地方', '最喜欢哪', '哪里最好', '哪个地方最好'],
      say: function (c) {
        return '唔…最喜欢窗边。\n因为站在那里，能第一个看见你回来。';
      },
      chips: function () { return ['带我去窗边', '陪我玩一会儿', '你好可爱']; }
    },
    {
      id: 'why_like', k: ['为什么喜欢'],
      say: function (c) { return c.where.like || '因为这里是你布置的呀。'; },
      chips: function () { return ['那我常来', '你饿不饿', '我摸摸你']; }
    },
    {
      id: 'where', k: ['什么地方', '这是哪', '这里是', '在哪', '哪里呀', '这是什么地方'],
      say: function (c) { return c.where.look || '这里是我们的小窝呀。'; },
      chips: function (c) { return c.where.chips; }
    },
    {
      id: 'lie', k: ['躺一下', '坐一下', '躺下', '坐上来', '一起睡', '上来'],
      say: function (c) {
        if (c.spot === 'bed') return '当然可以呀，被子很大。\n给你留一半，我睡边上。';
        return '好呀，这边给你留着。\n我先让一让——';
      },
      chips: function () { return ['你困不困', '给我讲讲你的事', '我摸摸你']; }
    },

    /* ---- 日常 ---- */
    {
      id: 'goto', k: ['带我去', '去床边', '去窗边', '去猫爬架', '去书柜', '去桌子', '去猫窝', '去小屋'],
      say: function (c) {
        var hit = null;
        SPOTS.forEach(function (s) { if (c.raw.indexOf(s.name) >= 0) hit = s; });
        if (!hit) {
          return '你想去哪儿？\n点一下房间里的家具，我就带你过去。';
        }
        state.gotoSpot = hit.id;
        return '好呀，跟我来～\n（在前面带路，尾巴一摇一摇）';
      },
      chips: function () { return ['这里是什么地方', '陪我玩一会儿', '你最喜欢哪个地方']; }
    },
    {
      id: 'doing', k: ['做什么', '干嘛', '干什么', '忙什么', '忙吗'],
      say: function (c) { return pick(c.where.doing || HOME_TALK.doing); },
      chips: function (c) { return c.where.chips; }
    },
    {
      id: 'give', k: ['给你', '拿去吧', '吃吧', '去吃吧', '喂你'],
      say: function (c) {
        state.mood = Math.min(100, state.mood + 9);
        return '哇！是给我的吗？\n谢谢你，我分你一半～';
      },
      chips: function () { return ['你还要吗', '好吃吗', '我摸摸你']; }
    },
    {
      id: 'more_food', k: ['还要', '再来', '够吗', '吃饱', '还有吗'],
      say: function () {
        return '已经吃得很饱啦～\n剩下的留到晚上，我们一起吃。';
      },
      chips: function () { return ['你真好', '我摸摸你', '陪我玩一会儿']; }
    },
    {
      id: 'taste', k: ['好吃', '好吃吗', '香吗', '味道'],
      say: function () {
        return '好吃呀，脆脆的。\n你要不要也来一口？';
      },
      chips: function () { return ['谢谢你', '我摸摸你', '你饿不饿']; }
    },
    {
      id: 'no_food', k: ['没有', '没得', '等我', '等一下', '待会', '下次'],
      say: function () {
        return '那我先忍一忍…\n等你有空再给我嘛，我不急。';
      },
      chips: function () { return ['你真乖', '你饿不饿', '陪我玩一会儿']; }
    },
    {
      id: 'food', k: ['饿', '吃', '饭', '零食', '鱼干', '牛奶', '饼干', '点心'],
      say: function (c) {
        if (c.spot === 'table') return '桌上那杯牛奶还热着…\n我可以喝一小口吗？';
        return '有点想吃小鱼干…\n你会给我吗？';
      },
      chips: function () { return ['给你一根小鱼干', '我这儿没有诶', '等我一下']; }
    },
    {
      id: 'sleep', k: ['困', '睡', '晚安', '休息', '哈欠', '做梦'],
      say: function (c) { return c.where.sleep || '那我靠着你眯一会儿，就一会儿。'; },
      chips: function () { return ['你睡吧', '我陪你一会儿', '我该走了']; }
    },
    {
      id: 'accompany', k: ['陪你', '陪着你', '陪一会儿'],
      say: function () {
        return '（往你手边挪了挪）\n嗯…有你在就不怕黑了。';
      },
      chips: function () { return ['你困不困', '给我讲讲你的事', '我该走了']; }
    },
    {
      id: 'play', k: ['玩', '球', '游戏', '一起'],
      say: function (c) { return c.where.play || '好呀，去地毯上追球吧！'; },
      chips: function () { return ['开始吧', '你跑得快吗', '我摸摸你']; }
    },
    {
      id: 'start', k: ['开始吧', '开始', '来吧', '走吧', '一起玩'],
      say: function () {
        return '那我先跑啦！\n（已经冲到地毯中间，回头看你一眼）';
      },
      chips: function () { return ['你跑得快吗', '我摸摸你', '你困不困']; }
    },
    {
      id: 'fast', k: ['跑得快', '跑得动', '快吗', '追不上'],
      say: function () {
        return '当然快呀，我可是每天在屋里巡逻三圈的。\n不过我会等你的。';
      },
      chips: function () { return ['那你等等我', '我摸摸你', '你饿不饿']; }
    },
    {
      id: 'pet', k: ['摸', '抱', 'rua', '撸', '揉', '蹭', '挠下巴'],
      say: function (c) {
        state.mood = Math.min(100, state.mood + 6);
        return pick([
          '（把脑袋凑过来）这里…可以摸。',
          '唔…好舒服。\n再摸一下也可以。',
          '（眯起眼睛，喉咙里发出呼噜声）'
        ]);
      },
      chips: function () { return ['再摸一下', '你好软', '你饿不饿']; }
    },
    {
      id: 'soft', k: ['好软', '软吗', '软软的', '毛'],
      say: function () {
        return '（团成一个球）\n软软的哦，像刚晒过的被子。';
      },
      chips: function () { return ['再摸一下', '你好可爱', '你饿不饿']; }
    },
    {
      id: 'spin', k: ['转个圈', '转圈', '看看你'],
      say: function () {
        return '（原地转了一圈，尾巴扫过地板）\n怎么样，毛毛蓬起来了吧。';
      },
      chips: function () { return ['你好可爱', '我摸摸你', '陪我玩一会儿']; }
    },
    {
      id: 'cute', k: ['可爱', '萌', '漂亮', '好看', '好乖', '真乖', '乖乖', '帅'],
      say: function () {
        state.mood = Math.min(100, state.mood + 4);
        return '嘿嘿，被你发现啦。\n我今天特意理了毛。';
      },
      chips: function () { return ['转个圈给我看', '我摸摸你', '你饿不饿']; }
    },
    {
      id: 'story', k: ['讲讲', '再讲', '故事', '秘密', '小时候', '以前', '过去'],
      say: function (c) {
        return '秘密…我只告诉你一个：\n我最喜欢的事，是你回来的时候叫我名字。';
      },
      chips: function () { return ['我记住了', '再讲一个', '我摸摸你']; }
    },
    {
      id: 'weather', k: ['天气', '窗外', '外面', '樱花', '下雨', '太阳', '晴', '云'],
      say: function () {
        return '窗外在飘樱花，风一吹就像下雪。\n要不要去窗边一起看？';
      },
      chips: function () { return ['带我去窗边', '外面冷吗', '你怕冷吗']; }
    },
    {
      id: 'cold', k: ['怕冷', '冷吗', '冷不冷'],
      say: function () {
        return '我有一身毛毛呀，不怕冷。\n倒是你，手凉凉的，要不要贴着我？';
      },
      chips: function () { return ['那你暖暖我', '我摸摸你', '你困不困']; }
    },
    {
      id: 'warm', k: ['暖暖', '暖手', '贴着我', '暖和'],
      say: function () {
        return '（整只贴在你手心里）\n这样暖一点吗？我体温偏高的。';
      },
      chips: function () { return ['谢谢你', '我摸摸你', '你困不困']; }
    },
    {
      id: 'come_more', k: ['常来', '天天来', '每天都来', '一直来'],
      say: function () {
        return '那我每天都在这儿等你。\n（把门口的位置先占好）';
      },
      chips: function () { return ['我记住了', '你饿不饿', '陪我玩一会儿']; }
    },
    {
      id: 'better', k: ['我好多', '好些了', '没事了', '好一点'],
      say: function () {
        return '那就好。\n我陪你到你不难过为止。';
      },
      chips: function () { return ['谢谢你', '我摸摸你', '陪我玩一会儿']; }
    },
    {
      id: 'backsoon', k: ['很快回来', '马上回来', '就回来', '一会儿就回'],
      say: function () {
        return '嗯，我数着时间。\n（趴在门口，耳朵朝着门的方向）';
      },
      chips: function () { return ['你乖乖的', '我摸摸你', '你困不困']; }
    },
    {
      id: 'love', k: ['喜欢', '爱你', '宝贝', '最好了', '离不开', '真好'],
      say: function (c) {
        state.mood = Math.min(100, state.mood + 5);
        if (c.mood < 40) return '…谢谢你。\n我今天有点没用，但你这么说，我好多了。';
        return '我也喜欢你。\n（尾巴绕住你的手）';
      },
      chips: function () { return ['我常来看你', '你困不困', '给我讲讲你的事']; }
    },
    {
      id: 'sad', k: ['难过', '累', '烦', '压力', '不开心', 'emo', '伤心', '焦虑', '好难'],
      say: function () {
        state.mood = Math.min(100, state.mood + 3);
        return '那…我安静地陪你坐一会儿吧。\n不用说话也可以。';
      },
      chips: function () { return ['谢谢你', '我好多啦', '我陪你一会儿']; }
    },
    {
      id: 'thanks', k: ['谢谢', '谢啦', '感谢'],
      say: function (c) { return '不用谢呀。\n你开心，我就开心。'; },
      chips: function () { return ['你真好', '陪我玩一会儿', '我摸摸你']; }
    },
    {
      id: 'bye', k: ['再见', '拜拜', '走了', '该走', '下线', '出去'],
      say: function (c) {
        return c.user ? '那…' + c.user + '，早点回来。\n我在这儿等你。' : '那…早点回来。\n我在这儿等你。';
      },
      chips: function () { return ['我很快回来', '你乖乖的', '我摸摸你']; }
    },
    {
      id: 'help', k: ['怎么玩', '能做什么', '帮助', '不会玩', '教我'],
      say: function () {
        return '把鼠标移到家具上，会出现名字。\n点一下，我就带你过去；点空白处就回到全景。';
      },
      chips: function () { return ['这里是什么地方', '你最喜欢哪个地方', '陪我玩一会儿']; }
    },
    {
      id: 'hi', k: ['你好', '您好', '嗨', 'hi', 'hello', '在吗', '在么', '早安', '晚上好', '下午好', '早上好'],
      say: function (c) {
        var h = new Date().getHours();
        var g = h < 11 ? '早上好呀～' : (h < 18 ? '下午好～' : '晚上好呀～');
        return g + '\n我刚在' + c.here + '发呆呢。';
      },
      chips: function () { return ['你在做什么呀', '这里是什么地方', '陪我玩一会儿']; }
    }
  ];

  function matchRule(low) {
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      for (var j = 0; j < r.k.length; j++) {
        if (low.indexOf(r.k[j]) >= 0) return r;
      }
    }
    return null;
  }

  function talk(raw) {
    var text = String(raw || '').trim();
    var low = text.toLowerCase();
    var c = ctx(text);
    var rule = matchRule(low);
    var out;

    if (!rule) {
      out = {
        text: pick([
          '唔…（歪了歪头）我没太听懂。\n你是想问「' + pick(['你在做什么', '这里是什么地方', '你饿不饿']) + '」吗？',
          '这个我不太懂诶…\n不过你愿意跟我说话，我就很开心了。',
          '（把爪子搭在你手上）\n你想说什么都可以，我听着呢。'
        ]),
        chips: c.where.chips,
        rule: 'fallback'
      };
    } else {
      var body = rule.say(c);
      var hits = state.ruleHits[rule.id] || 0;
      state.ruleHits[rule.id] = hits + 1;

      // 同一句话被问第二遍时换个开场，避免复读
      if (hits > 0 && rule.id !== 'setname' && hits < 3) {
        body = pick(['又问一次呀～', '嗯…你刚刚也问过这个。', '我再说一遍哦：']) + '\n' + body;
      }

      var chips = typeof rule.chips === 'function' ? rule.chips(c) : (rule.chips || c.where.chips);
      out = { text: body, chips: chips && chips.length ? chips : c.where.chips, rule: rule.id };
    }

    if (state.mood < 30 && out.rule !== 'sad') {
      out.text = '（有点没精神）' + out.text;
    }

    state.lastRule = out.rule;
    return out;
  }

  function userSay(text) {
    if (!text) return;
    stopTyping();
    dlgEcho.textContent = '你：' + text;
    dlgEcho.classList.add('on');
    dlgText.classList.add('thinking');
    dlgText.textContent = '· · ·';
    setChips([]);

    setTimeout(function () {
      var r = talk(text);
      dlgText.classList.remove('thinking');
      say(r.text, true);
      setChips(r.chips);
      renderCard();
      save();

      // 它答应了带路：先把话说完，再走过去
      if (state.gotoSpot) {
        var id = state.gotoSpot;
        state.gotoSpot = null;
        var target = SPOTS.filter(function (x) { return x.id === id; })[0];
        if (target) setTimeout(function () { goSpot(target); }, 1500);
      }
    }, 320 + Math.random() * 240);
  }

  /* ================= 宠物 / 卡片 ================= */
  function renderPet() {
    var p = pet();
    petImg.src = p.texture || '';
    petImg.alt = p.name;
    dlgImg.src = p.texture || '';
    dlgImg.alt = p.name;
    cardAva.src = p.texture || '';
    dlgName.textContent = p.name;
    renderCard();
  }

  function renderCard() {
    var p = pet();
    cardName.textContent = p.name;
    cardLv.textContent = state.lv;
    cardMood.style.width = Math.max(8, Math.min(100, state.mood)) + '%';
  }

  function switchPet() {
    if (!DATA.length) return;
    state.idx = (state.idx + 1) % DATA.length;
    save();
    renderPet();
    var p = pet();
    openDialog();
    dlgHere.textContent = '· ' + hereOf();
    dlgEcho.classList.remove('on');
    say('换我啦～我是' + p.name + '。\n' + (p.quote || '今天也请多关照。'), true);
    setChips(['你叫什么名字', '你在做什么呀', '陪我玩一会儿']);
    hop();
  }

  /* ================= 事件 ================= */
  function hideHint() {
    if (!hint || hint.classList.contains('gone')) return;
    hint.classList.add('gone');
  }

  stage.addEventListener('click', function (e) {
    if (e.target.closest('.spot')) return;
    if (e.target.closest('.dialog, .hud, .tool, .petcard, .dlg-chips')) return;
    if (state.spot) reset();
  });

  btnHeart.addEventListener('click', function () {
    btnHeart.classList.remove('pop');
    void btnHeart.offsetWidth;
    btnHeart.classList.add('pop');
    state.mood = Math.min(100, state.mood + 6);
    renderCard();
    save();
    openDialog();
    dlgHere.textContent = '· ' + hereOf();
    dlgEcho.classList.remove('on');
    say(pick([
      '（眯起眼睛）舒服…\n再摸一下嘛。',
      '（蹭你的手心）\n你的手好暖。',
      '唔…这里也要。\n（把脑袋转过来）'
    ]), true);
    setChips(['再摸一下', '你好可爱', '你饿不饿']);
    hop();
  });

  $('#btnReset').addEventListener('click', reset);
  $('#btnSwitch').addEventListener('click', switchPet);

  var pop = $('#pop');

  $('#btnMore').addEventListener('click', function (e) {
    e.stopPropagation();
    pop.classList.toggle('show');
  });

  pop.addEventListener('click', function (e) {
    e.stopPropagation();
    var b = e.target.closest('[data-act]');
    if (!b) { pop.classList.remove('show'); return; }
    pop.classList.remove('show');
    if (b.dataset.act === 'switch') switchPet();
    if (b.dataset.act === 'chat') {
      state.chatting = true;
      dialog.classList.add('chatting');
      openDialog();
      setTimeout(function () { chatInput.focus(); }, 80);
    }
  });

  document.addEventListener('click', function () { pop.classList.remove('show'); });

  btnChat.addEventListener('click', function () {
    state.chatting = !state.chatting;
    dialog.classList.toggle('chatting', state.chatting);
    if (state.chatting) {
      if (!dialog.classList.contains('show')) openDialog();
      setTimeout(function () { chatInput.focus(); }, 60);
    }
  });

  function send() {
    var v = chatInput.value.trim();
    if (!v) return;
    chatInput.value = '';
    userSay(v);
    state.mood = Math.min(100, state.mood + 1);
    renderCard();
    save();
  }

  btnSend.addEventListener('click', send);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Escape') { chatInput.blur(); }
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (state.chatting) { state.chatting = false; dialog.classList.remove('chatting'); }
      else if (state.spot) reset();
      else closeDialog();
    }
  });

  var rzTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(fitWorld, 120);
  });

  /* ================= 初始化 ================= */
  (function init() {
    var qs = new URLSearchParams(location.search);

    load();
    buildSpots();
    fitWorld();

    // 近景图先预加载，切换时不会白一下
    SPOTS.forEach(function (s) { var i = new Image(); i.src = s.img; });

    var vg = document.createElement('div');
    vg.className = 'vignette';
    stage.appendChild(vg);

    if (qs.get('pet')) {
      var n = parseInt(qs.get('pet'), 10);
      if (!isNaN(n) && DATA[n - 1]) state.idx = n - 1;
    }

    renderPet();
    setPet(50, 76, 21, '', true);

    if (/[?&]spots=1/.test(location.search)) stage.classList.add('debug');

    var lit = qs.get('lit');
    if (lit && spotEls[lit]) spotEls[lit].classList.add('lit');

    var pid = qs.get('spot');
    if (pid) {
      var s = SPOTS.filter(function (x) { return x.id === pid; })[0];
      if (s) setTimeout(function () { goSpot(s); }, 300);
    }

    // 开场白
    setTimeout(function () {
      if (state.spot) return;
      openDialog();
      dlgHere.textContent = '· 小窝';
      say('欢迎回来～\n想把鼠标移到家具上，点一下就能去那里。', true);
      setChips(HOME_TALK.chips);
    }, 800);

    setTimeout(hideHint, 6500);

    // 长时间不动，它会自己说一句
    setInterval(function () {
      if (!dialog.classList.contains('show') || state.chatting) return;
      if (document.activeElement === chatInput) return;
      say(pick(whereOf().doing || HOME_TALK.doing), true);
      setChips(whereOf().chips);
    }, 42000);

    window.__nest = {
      state: state, spots: SPOTS, goSpot: goSpot, reset: reset,
      switchPet: switchPet, say: say, talk: talk, userSay: userSay, rules: RULES,
      setPet: setPet, setChips: setChips, whereOf: whereOf
    };
  })();
})();
