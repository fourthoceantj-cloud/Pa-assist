/* 読み上げ（TTS）と効果音（チャイム・警報音）のエンジン
 * - 音声ファイルは使わない：声は端末の speechSynthesis、効果音は Web Audio で合成
 * - 長文は文単位に分割して読む（Chrome の約15秒で止まる不具合、iOS の onend 取りこぼし対策）
 */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;
  var audioCtx = null;
  var unlocked = false;

  var PREFERRED = {
    ja: ['Kyoko', 'O-ren', 'Otoya', 'Hattori', 'Google 日本語', 'Microsoft Nanami', 'Microsoft Ayumi', 'Microsoft Haruka'],
    en: ['Samantha', 'Ava', 'Allison', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Karen', 'Daniel']
  };

  function supported() { return !!(synth && global.SpeechSynthesisUtterance); }

  function voices() { return supported() ? synth.getVoices() : []; }

  function langOf(v) { return (v.lang || '').replace('_', '-').toLowerCase(); }

  function voicesFor(lang) {
    return voices().filter(function (v) { return langOf(v).indexOf(lang) === 0; });
  }

  /* 端末内（オフラインで使える）音声 → 優先名 → 地域（en-US）→ 既定 の順で選ぶ */
  function pickVoice(lang, savedName) {
    var list = voicesFor(lang);
    if (!list.length) return null;
    if (savedName) {
      var saved = list.filter(function (v) { return v.name === savedName; })[0];
      if (saved) return saved;
    }
    function score(v) {
      var s = 0;
      if (v.localService) s += 100;
      var idx = -1;
      PREFERRED[lang].forEach(function (n, i) { if (idx < 0 && v.name.indexOf(n) >= 0) idx = i; });
      if (idx >= 0) s += 50 - idx;
      if (lang === 'en' && langOf(v) === 'en-us') s += 20;
      if (lang === 'ja' && langOf(v) === 'ja-jp') s += 20;
      if (v.default) s += 5;
      return s;
    }
    return list.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }

  /* 文ごとに分割（日本語は「。」、英語は . ! ? : の後の空白） */
  function splitSentences(text, lang) {
    if (!text) return [];
    // 古い iOS でも動くよう後読み（lookbehind）は使わない
    var parts = lang === 'ja'
      ? (text.match(/[^。！？]+[。！？]*/g) || [])
      : (text.match(/[^.!?:]+(?:[.!?:]+|$)/g) || []);
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function applyFixes(text, fixes) {
    if (!fixes) return text;
    Object.keys(fixes).forEach(function (k) { text = text.split(k).join(fixes[k]); });
    return text;
  }

  function ensureAudio() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /* iOS では最初の読み上げ・音声再生をタップ操作の中で行う必要がある */
  function unlock() {
    ensureAudio();
    if (unlocked || !supported()) return;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
      unlocked = true;
    } catch (e) { /* noop */ }
  }

  var current = { token: 0, nodes: [] };

  function sleep(ms, token) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() {
        if (token !== current.token || Date.now() - t0 >= ms) return res();
        setTimeout(tick, 50);
      })();
    });
  }

  function tone(ctx, freq, start, dur, type, gainPeak) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gainPeak || 0.5, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.05);
    current.nodes.push(o);
    return o;
  }

  /* ピンポンパンポン（上昇4音） */
  function chime(token) {
    var ctx = ensureAudio();
    if (!ctx) return Promise.resolve();
    var t = ctx.currentTime + 0.05;
    [698.46, 880.0, 1046.5, 1396.9].forEach(function (f, i) {
      tone(ctx, f, t + i * 0.42, 1.4, 'sine', 0.45);
      tone(ctx, f * 2, t + i * 0.42, 0.6, 'sine', 0.06);
    });
    return sleep(2600, token);
  }

  /* ウーウーウー（上下に揺れる警報音 × 3） */
  function siren(token) {
    var ctx = ensureAudio();
    if (!ctx) return Promise.resolve();
    var t = ctx.currentTime + 0.05;
    var cycle = 1.3, n = 3;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    for (var i = 0; i < n; i++) {
      o.frequency.setValueAtTime(520, t + i * cycle);
      o.frequency.linearRampToValueAtTime(980, t + i * cycle + cycle * 0.6);
      o.frequency.linearRampToValueAtTime(520, t + (i + 1) * cycle);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.1);
    g.gain.setValueAtTime(0.28, t + n * cycle - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n * cycle);
    o.connect(lp); lp.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + n * cycle + 0.05);
    current.nodes.push(o);
    return sleep(n * cycle * 1000 + 400, token);
  }

  /* 1文を読み上げる。onend が来ない端末向けに speaking を監視して先へ進める */
  function speakOne(text, lang, opts, token) {
    return new Promise(function (resolve) {
      if (!supported() || token !== current.token) return resolve();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
      var v = opts.voices && opts.voices[lang];
      if (v) u.voice = v;
      u.rate = opts.rate || 0.9;
      u.pitch = 1;
      u.volume = opts.volume == null ? 1 : opts.volume;
      var done = false, seen = false, t0 = Date.now();
      var timer = null;
      function finish() {
        if (done) return;
        done = true;
        clearInterval(timer);
        resolve();
      }
      u.onstart = function () { seen = true; };
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
      timer = setInterval(function () {
        if (token !== current.token) return finish();
        if (synth.speaking) { seen = true; return; }
        if (seen && Date.now() - t0 > 400) return finish();
        if (!seen && Date.now() - t0 > 5000) return finish();
      }, 250);
    });
  }

  /* steps: [{kind:'sound', sound:'chime'|'siren'} | {kind:'speech', lang, text} | {kind:'pause', ms}]
   * hooks.onStep(index, step, sentenceIndex, sentences)
   */
  function play(steps, opts, hooks) {
    stop();
    var token = ++current.token;
    hooks = hooks || {};
    var fixes = opts.fixes || {};
    return (async function () {
      for (var i = 0; i < steps.length; i++) {
        if (token !== current.token) return false;
        var s = steps[i];
        if (s.kind === 'sound') {
          hooks.onStep && hooks.onStep(i, s, -1, []);
          await (s.sound === 'siren' ? siren(token) : chime(token));
        } else if (s.kind === 'pause') {
          hooks.onStep && hooks.onStep(i, s, -1, []);
          await sleep(s.ms || 800, token);
        } else if (s.kind === 'speech') {
          var sentences = splitSentences(s.text, s.lang);
          for (var k = 0; k < sentences.length; k++) {
            if (token !== current.token) return false;
            hooks.onStep && hooks.onStep(i, s, k, sentences);
            await speakOne(applyFixes(sentences[k], fixes[s.lang]), s.lang, opts, token);
            await sleep(s.lang === 'ja' ? 250 : 200, token);
          }
          await sleep(600, token);
        }
      }
      return token === current.token;
    })();
  }

  function stop() {
    current.token++;
    if (supported()) { try { synth.cancel(); } catch (e) { /* noop */ } }
    current.nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* noop */ } });
    current.nodes = [];
  }

  function onVoicesChanged(cb) {
    if (!supported()) return;
    if (synth.addEventListener) synth.addEventListener('voiceschanged', cb);
    else synth.onvoiceschanged = cb;
  }

  global.PA_SPEECH = {
    supported: supported,
    voices: voices,
    voicesFor: voicesFor,
    pickVoice: pickVoice,
    splitSentences: splitSentences,
    unlock: unlock,
    play: play,
    stop: stop,
    chime: function () { unlock(); var t = ++current.token; return chime(t); },
    siren: function () { unlock(); var t = ++current.token; return siren(t); },
    onVoicesChanged: onVoicesChanged
  };
})(window);
