/* 館内放送アシスト — 画面と操作 */
(function () {
  'use strict';

  var SP = window.PA_SPEECH;
  var APP_VERSION = '1.0.0';
  var SETTINGS_KEY = 'pa-assist-settings-v1';

  var S = {
    data: null,
    route: { name: 'home' },
    prevRoute: null,
    setup: {},
    custom: null,
    manualStep: 0,
    settings: loadSettings(),
    playing: null,
    wakeLock: null,
    swWaiting: null
  };

  var app = document.getElementById('app');
  var overlay = document.getElementById('onair');

  /* ---------- 小道具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loadSettings() {
    var def = { jaVoice: '', enVoice: '', rate: 0.9 };
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) { var o = JSON.parse(raw); for (var k in o) def[k] = o[k]; }
    } catch (e) { /* 保存できない端末でも動く */ }
    return def;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch (e) { /* noop */ }
  }
  function ord(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function floorInfo(f) {
    if (!f) return null;
    var base = f.charAt(0) === 'B';
    return {
      id: f,
      ja: base ? '地下' + f.slice(1) + '階' : f + '階',
      en: base ? 'basement level ' + f.slice(1) : ord(parseInt(f, 10)) + ' floor',
      kana: S.data.floors.kana[f] || f
    };
  }
  function aboveOf(f) {
    var list = S.data.floors.list;
    var i = list.indexOf(f);
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  }
  function fill(text, fl, ab) {
    if (!text) return '';
    return text
      .replace(/\{floor_(ja|en|kana)\}/g, function (m, k) { return fl ? fl[k] : '〇〇階'; })
      .replace(/\{above_(ja|en|kana)\}/g, function (m, k) { return ab ? ab[k] : '〇〇階'; });
  }
  function patternById(id) {
    return S.data.patterns.filter(function (p) { return p.id === id; })[0];
  }
  function currentVoices() {
    return {
      ja: SP.pickVoice('ja', S.settings.jaVoice),
      en: SP.pickVoice('en', S.settings.enVoice)
    };
  }
  function icon(name, size, color) {
    size = size || 20; color = color || 'currentColor';
    var p = {
      back: '<path d="m15 6-6 6 6 6"/>',
      chev: '<path d="m9 6 6 6-6 6"/>',
      play: '<path d="M7 4.5v15l13-7.5z" fill="' + color + '" stroke="none"/>',
      stop: '<rect x="4" y="4" width="16" height="16" rx="2" fill="' + color + '" stroke="none"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
      speaker: '<path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>',
      keyboard: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h2M11 9h2M15 9h2M7 13h10"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
      ear: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>'
    }[name] || '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color +
      '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  function header(title, badge, tone) {
    return '<header class="bar">' +
      '<a class="icon-btn" href="#/" aria-label="ホームに戻る">' + icon('back', 22, '#fff') + '</a>' +
      (badge ? '<span class="badge-sm tone-' + tone + '">' + esc(badge) + '</span>' : '') +
      '<h1 class="bar-title">' + esc(title) + '</h1>' +
      '</header>';
  }

  /* ---------- 放送内容の組み立て ---------- */
  function setupFor(p) {
    if (!S.setup[p.id]) {
      var opts = {};
      (p.options || []).forEach(function (o) { opts[o.id] = !!o.default; });
      S.setup[p.id] = { floor: null, repeat: p.defaultRepeat || 1, opts: opts };
    }
    return S.setup[p.id];
  }
  function resolveSegments(p, st, floorOverride) {
    var fid = floorOverride || st.floor;
    var fl = floorInfo(fid);
    var abId = p.floor === 'fireAndAbove' && fid ? aboveOf(fid) : null;
    var ab = floorInfo(abId);
    var noAbove = p.floor === 'fireAndAbove' && fid && !abId;
    return p.segments.filter(function (s) {
      return !s.option || st.opts[s.option];
    }).map(function (s) {
      var t = noAbove && s.textNoAbove ? s.textNoAbove : s.text;
      var k = noAbove && s.kanaNoAbove ? s.kanaNoAbove : s.kana;
      return {
        type: s.type, sound: s.sound, lang: s.lang, label: s.label,
        firstLoopOnly: !!s.firstLoopOnly,
        text: fill(t, fl, ab), kana: fill(k, fl, ab)
      };
    });
  }
  function buildSteps(segs, repeat) {
    var steps = [];
    for (var r = 0; r < repeat; r++) {
      if (r > 0) steps.push({ kind: 'pause', ms: 1500, label: '間', loop: r });
      segs.forEach(function (s) {
        if (s.type === 'sound') {
          if (r > 0 && s.firstLoopOnly) return;
          steps.push({ kind: 'sound', sound: s.sound, label: s.label, loop: r });
        } else {
          steps.push({ kind: 'speech', lang: s.lang, text: s.text, label: s.label, loop: r });
        }
      });
    }
    return steps;
  }

  /* ---------- ホーム ---------- */
  function readiness() {
    if (!SP.supported()) {
      return { tone: 'danger', title: 'この端末・ブラウザは読み上げに対応していません', sub: 'Safari（iPhone）または Chrome（Android）で開いてください' };
    }
    var all = SP.voices();
    if (!all.length) return { tone: 'neutral', title: '読み上げ音声を確認しています…', sub: '数秒たっても変わらない場合は再読み込み' };
    var v = currentVoices();
    if (!v.ja) return { tone: 'danger', title: '日本語の読み上げ音声が見つかりません', sub: '端末の設定で日本語の音声を追加してください' };
    if (!v.en) return { tone: 'warn', title: '英語の読み上げ音声が見つかりません', sub: '日本語のみ再生されます。端末の設定で英語（米国）の音声を追加' };
    var off = navigator.serviceWorker && navigator.serviceWorker.controller ? 'オフライン起動OK' : '初回読み込み中（次回からオフライン起動可）';
    var local = v.ja.localService && v.en.localService ? '' : '　※一部の音声は通信が必要な可能性';
    return { tone: 'ok', title: '読み上げ準備OK　' + off, sub: '日本語：' + v.ja.name + '　／　英語：' + v.en.name + local };
  }
  function renderHome() {
    var r = readiness();
    var html = '<header class="bar bar-home">' +
      '<div class="brand">' + icon('speaker', 24, '#fff') +
      '<div><div class="brand-name">館内放送アシスト</div><div class="brand-sub">PA ASSIST · JA / EN</div></div></div>' +
      '<a class="icon-btn" href="#/settings" aria-label="設定">' + icon('gear', 22, '#fff') + '</a>' +
      '</header>';
    if (S.swWaiting) {
      html += '<button class="update" data-act="sw-update">新しい版があります — タップして更新</button>';
    }
    html += '<div class="ready tone-' + r.tone + '"><span class="ready-ic">' +
      icon(r.tone === 'ok' ? 'check' : 'alert', 18) + '</span><div><div class="ready-t">' + esc(r.title) +
      '</div><div class="ready-s">' + esc(r.sub) + '</div></div></div>';

    html += '<main class="home">';
    S.data.groups.forEach(function (g) {
      html += '<div class="group-h tone-text-' + (g.id === 'fire' ? 'fire' : 'info') + '">' +
        esc(g.label) + '　<span>' + esc(g.labelEn) + '</span></div>';
      var ps = S.data.patterns.filter(function (p) { return p.group === g.id; });
      html += '<div class="cards ' + (ps.length === 2 ? 'cards-2' : '') + '">';
      ps.forEach(function (p) {
        html += '<a class="card" href="#/p/' + p.id + '">' +
          '<span class="letter tone-' + p.tone + '">' + esc(p.id) + '</span>' +
          '<span class="card-body"><span class="card-t">' + esc(p.title) + '</span>' +
          '<span class="card-s">' + esc(p.subtitle) + '</span></span>' +
          (ps.length === 2 ? '' : icon('chev', 20, '#5B5F68')) + '</a>';
      });
      html += '</div>';
    });
    html += '<div class="group-h">その他　<span>OTHER</span></div>' +
      '<div class="cards cards-2">' +
      '<a class="card card-sm" href="#/custom">' + icon('keyboard', 22) +
      '<span class="card-body"><span class="card-t">臨時放送</span><span class="card-s">文字を入力して読み上げ</span></span></a>' +
      '<a class="card card-sm" href="#/manual/A">' + icon('mic', 22) +
      '<span class="card-body"><span class="card-t">手動読み上げ</span><span class="card-s">音が出ないとき</span></span></a>' +
      '</div>';
    html += '<p class="foot-note">文言データ ' + esc(S.data.version) + ' 版 ／ アプリ ' + APP_VERSION + '</p>';
    html += '</main>';
    app.innerHTML = html;
  }

  /* ---------- 放送パターン（準備画面） ---------- */
  function renderPattern(id) {
    var p = patternById(id);
    if (!p) return go('#/');
    var st = setupFor(p);
    var html = header(p.title, p.id, p.tone) + '<main class="pad">';

    if (p.floor) {
      var fl = floorInfo(st.floor);
      var abId = st.floor ? aboveOf(st.floor) : null;
      html += '<div class="lead">' + esc(p.floorPrompt) + '</div>';
      if (p.floor === 'fireAndAbove') {
        html += '<div class="floor-pair">' +
          '<div class="floor-box ' + (fl ? 'is-set' : '') + '"><span>火元階　避難</span><b>' + (fl ? esc(fl.ja) : '未選択') + '</b></div>' +
          '<div class="floor-box dashed ' + (fl ? 'is-set' : '') + '"><span>直上階　避難（自動）</span><b>' +
          (fl ? (abId ? esc(floorInfo(abId).ja) : 'なし（最上階）') : '—') + '</b></div></div>';
      } else {
        html += '<div class="floor-box wide ' + (fl ? 'is-set' : '') + '"><div><span>放送する階</span><b>' +
          (fl ? esc(fl.ja) : '未選択') + '</b></div><em>' + (fl ? esc(fl.en) : '') + '</em></div>';
      }
      html += '<div class="floor-grid" role="group" aria-label="階の選択">';
      S.data.floors.list.forEach(function (f) {
        var cls = 'fl';
        if (f.charAt(0) === 'B') cls += ' fl-b';
        if (f === st.floor) cls += ' is-on';
        else if (p.floor === 'fireAndAbove' && f === abId) cls += ' is-above';
        html += '<button type="button" class="' + cls + '" data-act="floor" data-v="' + f + '" aria-pressed="' +
          (f === st.floor) + '" aria-label="' + esc(floorInfo(f).ja) + '">' + f + '</button>';
      });
      html += '</div>';
    }

    (p.options || []).forEach(function (o) {
      html += '<label class="toggle"><span><b>' + esc(o.label) + '</b><small>' + esc(o.hint || '') + '</small></span>' +
        '<input type="checkbox" data-act="opt" data-v="' + o.id + '"' + (st.opts[o.id] ? ' checked' : '') + '></label>';
    });

    html += '<div class="row"><span class="row-l">繰り返し</span><div class="seg" role="group" aria-label="繰り返し回数">';
    [1, 2, 3].forEach(function (n) {
      html += '<button type="button" data-act="repeat" data-v="' + n + '" class="' + (st.repeat === n ? 'is-on' : '') +
        '" aria-pressed="' + (st.repeat === n) + '">' + n + '回</button>';
    });
    html += '</div></div>';

    var segs = resolveSegments(p, st);
    var ready = !p.floor || !!st.floor;
    var fl2 = floorInfo(st.floor);
    html += '<button type="button" class="go tone-' + p.tone + '" data-act="start" ' + (ready ? '' : 'disabled') + '>' +
      icon('play', 22, '#fff') + (ready ? (fl2 ? esc(fl2.ja) + 'で放送開始' : '放送開始') : '階を選んでください') + '</button>';
    html += '<div class="seq">' + segs.map(function (s) { return esc(s.label); }).join(' → ') +
      (st.repeat > 1 ? '　× ' + st.repeat + '回' : '') + '</div>';

    html += '<details class="preview"><summary>放送内容を確認</summary>';
    segs.forEach(function (s) {
      if (s.type === 'speech') {
        html += '<div class="pv"><span class="pv-l">' + esc(s.label) + '</span><p lang="' + s.lang + '">' + esc(s.text) + '</p></div>';
      }
    });
    html += '</details>';
    html += '<a class="sub-link" href="#/manual/' + p.id + (st.floor ? '/' + st.floor : '') + '">' + icon('mic', 18) +
      '音が出ないとき：手動読み上げ（カタカナ読み）</a>';
    html += '</main>';
    app.innerHTML = html;
  }

  /* ---------- 手動読み上げ ---------- */
  function renderManual(id, floor) {
    var p = patternById(id);
    if (!p) return go('#/');
    var st = setupFor(p);
    var segs = resolveSegments(p, st, floor).filter(function (s) { return s.type === 'speech'; });
    if (S.manualStep >= segs.length) S.manualStep = 0;
    var fl = floorInfo(floor || st.floor);
    var html = header('手動読み上げ', p.id, p.tone) + '<main class="pad">';

    html += '<div class="seg seg-wide" role="group" aria-label="パターン">';
    S.data.patterns.forEach(function (q) {
      html += '<a class="' + (q.id === p.id ? 'is-on' : '') + '" href="#/manual/' + q.id + '">' + q.id + '</a>';
    });
    html += '</div>';
    html += '<div class="tip">放送設備のマイクで、この文をそのまま読んでください。「／」で一呼吸。英語はカタカナを、ゆっくり・はっきり。' +
      (p.floor && !fl ? '<br><b>階数が未選択のため「〇〇階」と表示しています。</b>' : '') + '</div>';

    html += '<div class="tabs" role="tablist">';
    segs.forEach(function (s, i) {
      html += '<button type="button" role="tab" data-act="mstep" data-v="' + i + '" class="' + (i === S.manualStep ? 'is-on' : '') +
        '" aria-selected="' + (i === S.manualStep) + '">' + (i + 1) + '. ' + esc(s.label) + '</button>';
    });
    html += '</div>';

    var s = segs[S.manualStep];
    html += '<section class="read">';
    if (s && s.lang === 'ja') {
      SP.splitSentences(s.text, 'ja').forEach(function (line) {
        html += '<p class="read-ja">' + esc(line) + '</p>';
      });
    } else if (s) {
      (s.kana || '').split('／').forEach(function (line) {
        if (line.trim()) html += '<p class="read-kana">' + esc(line.trim()) + '</p>';
      });
      html += '<p class="read-en" lang="en">' + esc(s.text) + '</p>';
    }
    html += '</section>';
    html += '<div class="pager"><button type="button" data-act="mprev" ' + (S.manualStep === 0 ? 'disabled' : '') + '>前へ</button>' +
      '<button type="button" class="dark" data-act="mnext" ' + (S.manualStep >= segs.length - 1 ? 'disabled' : '') + '>次へ</button></div>';
    html += '</main>';
    app.innerHTML = html;
  }

  /* ---------- 臨時放送 ---------- */
  function customState() {
    if (!S.custom) {
      var t = S.data.customTemplates[0];
      S.custom = { tpl: t.id, ja: t.ja, en: t.en, useEn: true, chime: true, repeat: 2, error: '' };
    }
    return S.custom;
  }
  function renderCustom() {
    var c = customState();
    var html = header('臨時放送（文字入力→読み上げ）') + '<main class="pad">';
    html += '<div class="tip">端末の読み上げ音声で流します。火災・地震・津波は定型放送（A〜E）を優先してください。</div>';
    html += '<div class="lead-sm">ひな形から選ぶ</div><div class="chips">';
    S.data.customTemplates.forEach(function (t) {
      html += '<button type="button" class="chip ' + (c.tpl === t.id ? 'is-on' : '') + '" data-act="tpl" data-v="' + t.id + '">' + esc(t.label) + '</button>';
    });
    html += '</div>';
    html += '<label class="field"><span>日本語<small>［ ］の部分を書き換えてください</small></span>' +
      '<textarea rows="4" data-act="cja" lang="ja">' + esc(c.ja) + '</textarea></label>';
    html += '<label class="toggle"><span><b>英語も流す</b><small>日本語の後に続けて読み上げ</small></span>' +
      '<input type="checkbox" data-act="cuseen"' + (c.useEn ? ' checked' : '') + '></label>';
    if (c.useEn) {
      html += '<label class="field"><span>English<small>ひな形には対訳が入っています</small></span>' +
        '<textarea rows="4" data-act="cen" lang="en">' + esc(c.en) + '</textarea></label>';
    }
    html += '<label class="toggle"><span><b>最初にチャイムを鳴らす</b></span>' +
      '<input type="checkbox" data-act="cchime"' + (c.chime ? ' checked' : '') + '></label>';
    html += '<div class="row"><span class="row-l">繰り返し</span><div class="seg" role="group" aria-label="繰り返し回数">';
    [1, 2, 3].forEach(function (n) {
      html += '<button type="button" data-act="crepeat" data-v="' + n + '" class="' + (c.repeat === n ? 'is-on' : '') + '">' + n + '回</button>';
    });
    html += '</div></div>';
    html += '<div class="error" role="alert" id="cerr">' + esc(c.error) + '</div>';
    html += '<div class="two"><button type="button" class="ghost" data-act="ctest">' + icon('ear', 18) + '試聴</button>' +
      '<button type="button" class="go tone-dark" data-act="cstart">' + icon('play', 20, '#fff') + '放送開始</button></div>';
    html += '</main>';
    app.innerHTML = html;
  }
  function customValidate(c) {
    if (!c.ja.trim()) return '日本語の文を入力してください。';
    if (/[［\[]/.test(c.ja) || (c.useEn && /[［\[]/.test(c.en))) return '［ ］の部分が残っています。書き換えてから放送してください。';
    if (c.useEn && !c.en.trim()) return '英語の文を入力するか、「英語も流す」をオフにしてください。';
    return '';
  }

  /* ---------- 設定 ---------- */
  function renderSettings() {
    var v = currentVoices();
    function opts(lang, saved) {
      var list = SP.voicesFor(lang);
      var h = '<option value="">おすすめ（自動選択）</option>';
      list.forEach(function (x) {
        h += '<option value="' + esc(x.name) + '"' + (x.name === saved ? ' selected' : '') + '>' +
          esc(x.name) + '（' + esc(x.lang) + (x.localService ? '・端末内' : '・通信') + '）</option>';
      });
      return h;
    }
    var html = header('設定・テスト') + '<main class="pad">';
    html += '<div class="lead-sm">日本語の音声</div><select data-act="jav">' + opts('ja', S.settings.jaVoice) + '</select>' +
      '<div class="now">使用中：' + (v.ja ? esc(v.ja.name) : 'なし') + '</div>';
    html += '<div class="lead-sm">英語の音声</div><select data-act="env">' + opts('en', S.settings.enVoice) + '</select>' +
      '<div class="now">使用中：' + (v.en ? esc(v.en.name) : 'なし') + '</div>';
    html += '<div class="lead-sm">読み上げの速さ　<b id="ratev">' + S.settings.rate.toFixed(2) + '</b>（放送は 0.85〜0.95 推奨）</div>' +
      '<input type="range" min="0.7" max="1.2" step="0.05" value="' + S.settings.rate + '" data-act="rate" aria-label="読み上げの速さ">';
    html += '<div class="lead-sm">テスト</div><div class="grid2">' +
      '<button type="button" class="ghost" data-act="tja">日本語テスト</button>' +
      '<button type="button" class="ghost" data-act="ten">英語テスト</button>' +
      '<button type="button" class="ghost" data-act="tchime">チャイム</button>' +
      '<button type="button" class="ghost" data-act="tsiren">警報音</button></div>';
    html += '<details class="preview" open><summary>導入時のチェック（管理員の端末ごとに1回）</summary><ol class="check">' +
      '<li>ホーム画面に追加して、そのアイコンから起動する（iPhone：共有 → ホーム画面に追加 ／ Android：︙ → ホーム画面に追加）</li>' +
      '<li>上の4つのテストがすべて聞こえる</li>' +
      '<li>マナーモード（消音スイッチ）ONでも聞こえるか確認する</li>' +
      '<li>機内モードにしてアプリを起動し、読み上げできることを確認する</li>' +
      '<li>放送設備（マイクまたは外部入力）を通して館内で聞き取れる音量か確認する</li></ol></details>';
    html += '<button type="button" class="ghost wide" data-act="refresh">最新の版を読み込み直す</button>';
    html += '<p class="foot-note">アプリ ' + APP_VERSION + ' ／ 文言データ ' + esc(S.data.version) + ' 版<br>' + esc(S.data.source) + '</p>';
    html += '</main>';
    app.innerHTML = html;
  }

  /* ---------- 放送中 ---------- */
  function startPlayback(title, sub, steps, manualHref, opts) {
    SP.unlock();
    opts = opts || {};
    S.playing = {
      title: title, sub: sub, steps: steps, idx: 0, sentence: -1, sentences: [],
      startedAt: Date.now(), done: false, manualHref: manualHref,
      loops: steps.reduce(function (m, s) { return Math.max(m, (s.loop || 0) + 1); }, 1),
      again: opts.again
    };
    requestWake();
    renderOnAir();
    var v = currentVoices();
    SP.play(steps, { voices: v, rate: S.settings.rate, fixes: S.data.speechFixes }, {
      onStep: function (i, s, k, sentences) {
        if (!S.playing) return;
        S.playing.idx = i; S.playing.sentence = k; S.playing.sentences = sentences;
        renderOnAir();
      }
    }).then(function (completed) {
      if (!S.playing) return;
      if (completed) { S.playing.done = true; renderOnAir(); }
      releaseWake();
    });
  }
  function stopPlayback() {
    SP.stop();
    S.playing = null;
    releaseWake();
    overlay.hidden = true;
    overlay.innerHTML = '';
    document.body.classList.remove('is-onair');
  }
  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function renderOnAir() {
    var P = S.playing;
    if (!P) return;
    overlay.hidden = false;
    document.body.classList.add('is-onair');
    var step = P.steps[P.idx] || {};
    var loop = (step.loop || 0);
    var inLoop = P.steps.filter(function (s) { return (s.loop || 0) === loop && s.kind !== 'pause'; });
    var html = '<div class="oa-head">' +
      '<div class="oa-pill ' + (P.done ? 'is-done' : '') + '"><span class="dot"></span>' + (P.done ? '放送終了' : '放送中　ON AIR') + '</div>' +
      '<span class="oa-time" id="oatime">' + fmt(Date.now() - P.startedAt) + '</span></div>' +
      '<div class="oa-title"><b>' + esc(P.title) + '</b><span>' + (P.loops > 1 ? (loop + 1) + ' / ' + P.loops + ' 回目' : '') + '</span></div>' +
      (P.sub ? '<div class="oa-sub">' + esc(P.sub) + '</div>' : '');
    html += '<div class="oa-steps">';
    inLoop.forEach(function (s) {
      var gi = P.steps.indexOf(s);
      var cls = P.done || gi < P.idx ? 'done' : (gi === P.idx ? 'now' : '');
      html += '<span class="' + cls + '">' + (cls === 'done' ? icon('check', 13) : '') + esc(s.label) + '</span>';
    });
    html += '</div>';

    html += '<section class="oa-card">';
    if (P.done) {
      html += '<p class="oa-text">放送が終わりました。</p>';
    } else if (step.kind === 'speech') {
      html += '<div class="oa-cap">いま流れている文（窓口で画面を見せても可）</div><p class="oa-text" lang="' + step.lang + '">';
      P.sentences.forEach(function (t, k) {
        html += '<span class="' + (k === P.sentence ? 'cur' : (k < P.sentence ? 'past' : 'fut')) + '">' + esc(t) + ' </span>';
      });
      html += '</p>';
    } else if (step.kind === 'sound') {
      html += '<p class="oa-text">' + esc(step.label) + '…</p>';
    } else {
      html += '<p class="oa-text">次の繰り返しまで少し待機…</p>';
    }
    var next = P.steps.slice(P.idx + 1).filter(function (s) { return s.kind === 'speech'; })[0];
    if (next && !P.done) html += '<div class="oa-next"><span>次：</span>' + esc(next.label) + '　' + esc(next.text.slice(0, 60)) + '…</div>';
    html += '</section>';

    html += '<div class="oa-chips"><span>' + (S.wakeLock ? '画面スリープ防止中' : '再生中は画面を消さないでください') + '</span>' +
      '<span>端末の読み上げ音声</span></div>';
    html += '<div class="oa-grow"></div><div class="oa-actions">';
    if (P.done) {
      html += '<div class="two">' + (P.again ? '<button type="button" class="ghost-dark" data-act="again">もう一度流す</button>' : '') +
        '<button type="button" class="close" data-act="close">閉じる</button></div>';
    } else {
      if (P.manualHref) html += '<button type="button" class="ghost-dark" data-act="tomanual">' + icon('mic', 18) + '音が出ない → 手動読み上げに切替</button>';
      html += '<button type="button" class="stop" data-act="stop">' + icon('stop', 30, '#fff') + '停止　STOP</button>';
    }
    html += '</div>';
    overlay.innerHTML = html;
  }
  setInterval(function () {
    if (S.playing && !S.playing.done) {
      var el = document.getElementById('oatime');
      if (el) el.textContent = fmt(Date.now() - S.playing.startedAt);
    }
  }, 500);

  function requestWake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) {
      S.wakeLock = l;
      l.addEventListener('release', function () { S.wakeLock = null; });
      renderOnAir();
    }).catch(function () { S.wakeLock = null; });
  }
  function releaseWake() {
    if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) { /* noop */ } S.wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.playing && !S.playing.done && !S.wakeLock) requestWake();
  });

  /* ---------- 操作 ---------- */
  function go(h) { location.hash = h; }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    SP.unlock();
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    var act = el.getAttribute('data-act');
    var v = el.getAttribute('data-v');
    var r = S.route;
    var p = r.id ? patternById(r.id) : null;

    switch (act) {
      case 'floor': setupFor(p).floor = v; renderPattern(p.id); break;
      case 'repeat': setupFor(p).repeat = parseInt(v, 10); renderPattern(p.id); break;
      case 'start': {
        var st = setupFor(p);
        if (p.floor && !st.floor) return;
        var fl = floorInfo(st.floor);
        var sub = fl ? '警報作動階：' + fl.ja : '';
        if (p.floor === 'fireAndAbove') {
          var ab = aboveOf(st.floor);
          sub = '避難：' + fl.ja + (ab ? '・' + floorInfo(ab).ja : '') + (st.opts.standby ? '　／　その他の階：待機' : '');
        }
        var title = p.id + ' ' + p.title;
        var steps = buildSteps(resolveSegments(p, st), st.repeat);
        var href = '#/manual/' + p.id + (st.floor ? '/' + st.floor : '');
        var run = function () { startPlayback(title, sub, steps, href, { again: run }); };
        run();
        break;
      }
      case 'mstep': S.manualStep = parseInt(v, 10); render(); break;
      case 'mprev': S.manualStep = Math.max(0, S.manualStep - 1); render(); break;
      case 'mnext': S.manualStep += 1; render(); break;
      case 'tpl': {
        var t = S.data.customTemplates.filter(function (x) { return x.id === v; })[0];
        var c = customState();
        c.tpl = t.id; c.ja = t.ja; c.en = t.en; c.error = '';
        renderCustom();
        break;
      }
      case 'crepeat': customState().repeat = parseInt(v, 10); renderCustom(); break;
      case 'ctest':
      case 'cstart': {
        var c2 = customState();
        c2.error = customValidate(c2);
        if (c2.error) { document.getElementById('cerr').textContent = c2.error; return; }
        var steps2 = [];
        var test = act === 'ctest';
        var rep = test ? 1 : c2.repeat;
        for (var i = 0; i < rep; i++) {
          if (i > 0) steps2.push({ kind: 'pause', ms: 1500, label: '間', loop: i });
          if (i === 0 && c2.chime && !test) steps2.push({ kind: 'sound', sound: 'chime', label: 'チャイム', loop: i });
          steps2.push({ kind: 'speech', lang: 'ja', text: c2.ja.trim(), label: '日本語', loop: i });
          if (c2.useEn) steps2.push({ kind: 'speech', lang: 'en', text: c2.en.trim(), label: 'English', loop: i });
        }
        var ttl = test ? '臨時放送（試聴）' : '臨時放送';
        var csub = test ? '放送設備につなぐ前に端末で確認' : '';
        var run2 = function () { startPlayback(ttl, csub, steps2, null, { again: run2 }); };
        run2();
        break;
      }
      case 'tja': startPlayback('日本語テスト', '', [{ kind: 'speech', lang: 'ja', text: 'こちらは１階管理室です。これは放送のテストです。', label: '日本語' }], null); break;
      case 'ten': startPlayback('英語テスト', '', [{ kind: 'speech', lang: 'en', text: 'This is the management office. This is a test announcement.', label: 'English' }], null); break;
      case 'tchime': SP.chime(); break;
      case 'tsiren': SP.siren(); break;
      case 'refresh': refreshApp(); break;
      case 'sw-update': applySwUpdate(); break;
      case 'stop': stopPlayback(); break;
      case 'close': stopPlayback(); break;
      case 'again': { var a = S.playing && S.playing.again; stopPlayback(); if (a) a(); break; }
      case 'tomanual': { var h = S.playing.manualHref; stopPlayback(); S.manualStep = 0; go(h); break; }
    }
  }

  function onInput(e) {
    var el = e.target;
    var act = el.getAttribute && el.getAttribute('data-act');
    if (!act) return;
    var c = S.custom;
    switch (act) {
      case 'opt': setupFor(patternById(S.route.id)).opts[el.getAttribute('data-v')] = el.checked; renderPattern(S.route.id); break;
      case 'cja': c.ja = el.value; break;
      case 'cen': c.en = el.value; break;
      case 'cuseen': c.useEn = el.checked; renderCustom(); break;
      case 'cchime': c.chime = el.checked; break;
      case 'jav': S.settings.jaVoice = el.value; saveSettings(); renderSettings(); break;
      case 'env': S.settings.enVoice = el.value; saveSettings(); renderSettings(); break;
      case 'rate':
        S.settings.rate = parseFloat(el.value); saveSettings();
        var rv = document.getElementById('ratev'); if (rv) rv.textContent = S.settings.rate.toFixed(2);
        break;
    }
  }

  /* ---------- ルーティング ---------- */
  function parseRoute() {
    var h = (location.hash || '#/').replace(/^#/, '');
    var parts = h.split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1]) return { name: 'pattern', id: parts[1] };
    if (parts[0] === 'manual') return { name: 'manual', id: parts[1] || 'A', floor: parts[2] || null };
    if (parts[0] === 'custom') return { name: 'custom' };
    if (parts[0] === 'settings') return { name: 'settings' };
    return { name: 'home' };
  }
  function render() {
    var r = S.route;
    if (r.name === 'pattern') renderPattern(r.id);
    else if (r.name === 'manual') renderManual(r.id, r.floor);
    else if (r.name === 'custom') renderCustom();
    else if (r.name === 'settings') renderSettings();
    else renderHome();
  }
  function onRoute() {
    var prev = S.route;
    S.route = parseRoute();
    // ホームから入り直したときは階数を必ず選び直させる（前回の階で誤放送しないため）
    if (S.route.name === 'pattern' && prev.name === 'home' && S.setup[S.route.id]) S.setup[S.route.id].floor = null;
    if (S.route.name === 'manual' && (prev.name !== 'manual' || prev.id !== S.route.id)) S.manualStep = 0;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Service Worker（オフライン化と更新） ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      function track(w) {
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            S.swWaiting = w;
            if (S.route.name === 'home') renderHome();
          }
        });
      }
      if (reg.waiting && navigator.serviceWorker.controller) S.swWaiting = reg.waiting;
      reg.addEventListener('updatefound', function () { if (reg.installing) track(reg.installing); });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (S.route.name === 'home') renderHome();
      });
    }).catch(function () { /* file:// 等では登録できない */ });
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (S.reloadOnControllerChange && !refreshing) { refreshing = true; location.reload(); }
    });
  }
  function applySwUpdate() {
    if (!S.swWaiting) return location.reload();
    S.reloadOnControllerChange = true;
    S.swWaiting.postMessage('skipWaiting');
  }
  function refreshApp() {
    if (!('serviceWorker' in navigator)) return location.reload();
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return location.reload();
      reg.update().then(function () {
        if (reg.waiting) { S.swWaiting = reg.waiting; applySwUpdate(); }
        else location.reload();
      });
    });
  }

  /* ---------- 起動 ---------- */
  function boot() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    SP.onVoicesChanged(function () { if (S.route.name === 'home' || S.route.name === 'settings') render(); });

    fetch('./data/announcements.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        S.data = d;
        window.addEventListener('hashchange', onRoute);
        onRoute();
        // 一部の端末は音声一覧が遅れて届く
        setTimeout(function () { if (S.route.name === 'home') renderHome(); }, 1200);
      })
      .catch(function () {
        app.innerHTML = '<main class="pad"><div class="ready tone-danger"><div><div class="ready-t">文言データを読み込めませんでした</div>' +
          '<div class="ready-s">通信状態を確認して再読み込みしてください（初回起動は通信が必要です）</div></div></div>' +
          '<button class="ghost wide" onclick="location.reload()">再読み込み</button></main>';
      });
    registerSW();
  }
  boot();
})();
