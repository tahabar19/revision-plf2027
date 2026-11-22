/* Lecteur de révision audio – fonctionne avec des MP3 (audio/manifest.json)
   ou, à défaut, avec la synthèse vocale du téléphone (Web Speech API). */
(function () {
  'use strict';
  var D = window.DATA;
  var $ = function (id) { return document.getElementById(id); };
  var audio = $('audio');
  var synth = window.speechSynthesis || null;

  /* ---------------- stockage local (protégé) ---------------- */
  var store = {
    get: function (k, def) { try { var v = localStorage.getItem('rev27:' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('rev27:' + k, JSON.stringify(v)); } catch (e) { } }
  };
  var settings = Object.assign({ source: 'auto', voiceURI: '', rate: 1, autoNext: true, scroll: true }, store.get('settings', {}));
  var done = store.get('done', {});
  function saveSettings() { store.set('settings', settings); }

  /* ---------------- texte -> parole (identique à scripts/generate_audio.py) ---------------- */
  function normalize(t) {
    t = t.replace(/\s*\(([^()]*)\)/g, function (m, inner) { return /[؀-ۿ]/.test(inner.replace(/و/g, '')) ? m : ''; });
    t = t.replace(/\S*[A-Za-z]\S*\.[A-Za-z]{2,}\S*/g, '');
    t = t.replace(/[«»ـ]/g, '').replace(/≈/g, ' حوالي ');
    t = t.replace(/(\d{4})\s*[-–]\s*(\d{4})/g, '$1 إلى $2');
    t = t.replace(/(^|[\s(])−\s*(\d)/g, '$1ناقص $2');
    t = t.replace(/(^|[\s(])\+\s*(\d)/g, '$1زائد $2');
    t = t.replace(/\d+(?:[.,]\d+)*/g, function (s) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) return s.replace(/\./g, '');
      if (s.indexOf(',') >= 0) return s.replace(/,/g, ' فاصلة ');
      if (s.indexOf('.') >= 0) return s.replace(/\./g, ' نقطة ');
      return s;
    });
    t = t.replace(/\s*%/g, ' في المائة');
    t = t.replace(/(^|\s)و(\d)/g, '$1و $2');
    t = t.replace(/\s*[–—]\s*/g, '، ');
    return t.replace(/\s+/g, ' ').trim();
  }
  function segsOf(tr) { return [tr.spokenTitle || tr.title].concat(tr.paras); }
  function gapAfter(tr, i) { if (i === 0) return 0.9; if (tr.kind === 'quiz' && (i - 1) % 2 === 0) return 3.5; return 0.6; }
  function chunksOf(text) {
    var out = [];
    text.replace(/([.!?؟؛])\s+/g, '$1\u0000').split('\u0000').forEach(function (s) {
      s = s.trim(); if (!s) return;
      while (s.length > 220) {
        var cut = s.lastIndexOf('، ', 200);
        if (cut < 60) cut = s.lastIndexOf(' ', 200);
        if (cut < 60) cut = 200;
        out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
      }
      if (s) out.push(s);
    });
    return out;
  }

  /* ---------------- MP3 disponibles ? ---------------- */
  var manifest = null;
  function mp3For(tr) { return settings.source !== 'device' && manifest && manifest.tracks && manifest.tracks[tr.id] ? manifest.tracks[tr.id] : null; }

  /* ---------------- voix de l'appareil ---------------- */
  var voices = [], voice = null;
  var UA = navigator.userAgent || '';
  var IS_ANDROID = /Android/i.test(UA), IS_WEBVIEW = IS_ANDROID && /; wv\)/.test(UA);
  function langOf(v) { return String(v.lang || '').replace(/_/g, '-'); }
  function applyVoice(u) {
    // Android ignore souvent u.voice : la langue (au format ar-SA, pas ar_SA) est indispensable.
    if (voice) { u.voice = voice; u.lang = langOf(voice) || 'ar-SA'; } else u.lang = 'ar-SA';
  }
  function loadVoices() {
    if (!synth) return;
    var all = synth.getVoices() || [];
    voices = all.filter(function (v) { return /^ar([-_]|$)/i.test(v.lang || '') || /arab|عرب/i.test(v.name || ''); });
    var rank = function (v) { return (/ar-MA/i.test(langOf(v)) ? 0 : /ar-SA/i.test(langOf(v)) ? 1 : 2) + (v.localService === false ? 0.2 : 0) + (/google|neural|natural|enhanced|premium/i.test(v.name) ? 0 : 0.5); };
    voices.sort(function (a, b) { return rank(a) - rank(b); });
    voice = voices.filter(function (v) { return v.voiceURI === settings.voiceURI; })[0] || voices[0] || null;
    renderVoiceSelect();
    if (typeof renderVoiceWarn === 'function' && P && P.th >= 0) renderVoiceWarn();
  }
  if (synth) {
    loadVoices();
    if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 800); setTimeout(loadVoices, 2500);
  }

  /* ---------------- état ---------------- */
  // Thème et reprise mémorisés par identifiant (la v1 stockait des indices, avec 3 axes dans cet ordre)
  var OLD_ORDER = ['road', 'safety', 'logi'];
  function themeIdx(id) { for (var i = 0; i < D.themes.length; i++) if (D.themes[i].id === id) return i; return -1; }
  var ui = { th: themeIdx(store.get('themeId', OLD_ORDER[store.get('theme', -1)])), tab: 'episodes', view: 'theme' };
  if (ui.th < 0) ui.th = 0;
  function getLast() {
    var l = store.get('last', null), i, j;
    if (!l) return null;
    if (l.id) {
      for (i = 0; i < D.themes.length; i++) for (j = 0; j < D.themes[i].tracks.length; j++)
        if (D.themes[i].tracks[j].id === l.id) return { th: i, tr: j, seg: l.seg || 0 };
      return null;
    }
    i = themeIdx(OLD_ORDER[l.th]);
    return i >= 0 && D.themes[i].tracks[l.tr] ? { th: i, tr: l.tr, seg: l.seg || 0 } : null;
  }
  var P = { th: -1, tr: -1, seg: 0, chunk: 0, playing: false, mode: 'tts', token: 0, timer: null };
  function curTrack() { return P.th >= 0 ? D.themes[P.th].tracks[P.tr] : null; }

  /* ---------------- utilitaires d'affichage ---------------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* texte échappé + pourcentages isolés (affichage « +18,9% » correct en RTL) */
  function tx(s) { return esc(s).replace(/[+−]?\d[\d.,]*\s?%/g, '<bdi dir="ltr">$&</bdi>'); }
  function fmt(s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function estSecs(tr) {
    var m = manifest && manifest.tracks && manifest.tracks[tr.id];
    if (m && settings.source !== 'device') return m.duration;
    var c = segsOf(tr).join(' ').length;
    return c / 14 + segsOf(tr).length * 0.8;
  }
  function mins(s) { return Math.max(1, Math.round(s / 60)); }
  function themeColor(i) { return D.themes[i].color; }
  function arNum(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : (n >= 3 && n <= 10) ? n + ' ' + few : n + ' ' + many; }

  /* ---------------- rendu : onglets thèmes ---------------- */
  function renderThemes() {
    var nav = $('themeTabs'); nav.innerHTML = '';
    D.themes.forEach(function (th, i) {
      var n = th.tracks.length, k = th.tracks.filter(function (t) { return done[t.id]; }).length;
      var b = el('button', i === ui.th ? 'on' : '', '<span class="ic">' + th.icon + '</span><span>' + esc(th.title) + '</span><span class="pc">' + k + ' / ' + n + '</span>');
      b.style.setProperty('--tc', th.color);
      b.setAttribute('role', 'tab');
      b.onclick = function () { ui.th = i; store.set('themeId', D.themes[i].id); showView('theme'); renderAll(); window.scrollTo(0, 0); };
      nav.appendChild(b);
    });
  }

  function renderHero() {
    var th = D.themes[ui.th], hero = $('hero');
    var total = th.tracks.reduce(function (a, t) { return a + estSecs(t); }, 0);
    var k = th.tracks.filter(function (t) { return done[t.id]; }).length;
    var last = getLast();
    hero.innerHTML =
      '<h2>' + th.icon + ' ' + esc(th.title) + '</h2>' +
      '<p class="meta">' + arNum(th.tracks.length, 'حلقة واحدة', 'حلقتان', 'حلقات', 'حلقة') + ' · حوالي ' + mins(total) + ' دقيقة · أنهيت ' + k + ' من ' + th.tracks.length + '</p>' +
      '<div class="bar"><i style="width:' + Math.round(100 * k / th.tracks.length) + '%"></i></div>' +
      '<div class="actions"></div>';
    var act = hero.querySelector('.actions');
    var bAll = el('button', 'btn alt', '▶ تشغيل المحور كاملا');
    bAll.onclick = function () { settings.autoNext = true; saveSettings(); startTrack(ui.th, 0, 0, true); };
    act.appendChild(bAll);
    if (last && last.th === ui.th && !(P.th === last.th && P.tr === last.tr)) {
      var bRes = el('button', 'btn ghost', 'متابعة: الحلقة ' + (last.tr + 1));
      bRes.onclick = function () { startTrack(last.th, last.tr, last.seg || 0, true); };
      act.appendChild(bRes);
    }
  }

  function renderEpisodes() {
    var th = D.themes[ui.th], box = $('panelEpisodes'); box.innerHTML = '';
    th.tracks.forEach(function (t, i) {
      var isQuiz = t.kind === 'quiz';
      var cls = 'ep' + (done[t.id] ? ' done' : '') + (P.th === ui.th && P.tr === i ? ' now' : '') + (isQuiz ? ' quiz' : '');
      var b = el('button', cls);
      var src = mp3For(t) ? '' : ' · صوت الجهاز';
      var count = isQuiz ? arNum(t.paras.length / 2, 'سؤال واحد', 'سؤالان', 'أسئلة', 'سؤالا') : arNum(t.paras.length, 'فقرة واحدة', 'فقرتان', 'فقرات', 'فقرة');
      b.innerHTML = '<span class="ep-num">' + (isQuiz ? '?' : (done[t.id] ? '✓' : i + 1)) + '</span>' +
        '<span class="ep-body"><span class="ep-title">' + esc(t.title) + '</span>' +
        '<span class="ep-meta">' + (mp3For(t) ? fmt(estSecs(t)) : 'حوالي ' + mins(estSecs(t)) + ' د') + ' · ' + count + src + '</span></span>' +
        '<span class="ep-go" aria-hidden="true">' + (P.th === ui.th && P.tr === i && P.playing ? '❚❚' : '▶') + '</span>';
      b.onclick = function () {
        if (P.th === ui.th && P.tr === i) { showReader(); if (!P.playing) play(); }
        else startTrack(ui.th, i, 0, true);
      };
      box.appendChild(b);
    });
  }

  function renderFacts() {
    var th = D.themes[ui.th], box = $('panelFacts'); box.innerHTML = '';
    var head = el('div', 'panel-head', '<p>الأرقام التي يجب حفظها في محور ' + esc(th.title) + '</p>');
    var recap = th.tracks.filter(function (t) { return /مراجعة سريعة/.test(t.title); })[0];
    if (recap) {
      var b = el('button', 'btn small', '▶ استمع إلى المراجعة السريعة');
      b.onclick = function () { startTrack(ui.th, th.tracks.indexOf(recap), 0, true); };
      head.appendChild(b);
    }
    box.appendChild(head);
    var grid = el('div', 'facts');
    th.facts.forEach(function (f) { grid.appendChild(el('div', 'fact', '<b>' + tx(f.v) + '</b><span>' + tx(f.l) + '</span>')); });
    box.appendChild(grid);
  }

  /* ---------------- quiz (cartes) ---------------- */
  var Q = { th: -1, order: [], i: 0, shown: false, ok: 0, review: [] };
  function quizReset(shuffle) {
    var n = D.themes[ui.th].quiz.length;
    Q = { th: ui.th, order: Array.from({ length: n }, function (_, i) { return i; }), i: 0, shown: false, ok: 0, review: [] };
    if (shuffle) for (var i = n - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = Q.order[i]; Q.order[i] = Q.order[j]; Q.order[j] = x; }
  }
  function renderQuiz() {
    if (Q.th !== ui.th) quizReset(false);
    var th = D.themes[ui.th], box = $('panelQuiz'); box.innerHTML = '';
    var head = el('div', 'panel-head', '<p>بطاقات سؤال وجواب – حاول الإجابة قبل كشف الجواب</p>');
    var qt = th.tracks.filter(function (t) { return t.kind === 'quiz'; })[0];
    if (qt) { var b = el('button', 'btn small', '▶ نسخة صوتية'); b.onclick = function () { startTrack(ui.th, th.tracks.indexOf(qt), 0, true); }; head.appendChild(b); }
    box.appendChild(head);
    var card = el('div', 'card');
    if (Q.i >= Q.order.length) {
      card.className = 'card q-done';
      card.innerHTML = '<div class="big">' + Q.ok + ' / ' + Q.order.length + '</div><p>إجابات صحيحة</p>';
      if (Q.review.length) {
        var ul = '<div style="text-align:right">';
        Q.review.forEach(function (k) { var q = th.quiz[k]; ul += '<p><b>' + tx(q.q) + '</b><br>' + tx(q.a) + '</p>'; });
        card.innerHTML += '<p><b>للمراجعة:</b></p>' + ul + '</div>';
      }
      var again = el('button', 'btn', 'إعادة بترتيب عشوائي'); again.onclick = function () { quizReset(true); renderQuiz(); };
      card.appendChild(again);
    } else {
      var q = th.quiz[Q.order[Q.i]];
      card.innerHTML = '<div class="q-count"><span>السؤال ' + (Q.i + 1) + ' من ' + Q.order.length + '</span><span>✓ ' + Q.ok + '</span></div>' +
        '<div class="q-text">' + tx(q.q) + '</div>' + (Q.shown ? '<div class="q-ans">' + tx(q.a) + '</div>' : '');
      var btns = el('div', 'q-btns');
      if (!Q.shown) {
        var s = el('button', 'btn', 'أظهر الجواب'); s.onclick = function () { Q.shown = true; renderQuiz(); }; btns.appendChild(s);
      } else {
        var y = el('button', 'btn', '✓ عرفته'); y.onclick = function () { Q.ok++; Q.i++; Q.shown = false; renderQuiz(); };
        var n = el('button', 'btn ghost', '↻ أحتاج مراجعته'); n.onclick = function () { Q.review.push(Q.order[Q.i]); Q.i++; Q.shown = false; renderQuiz(); };
        btns.appendChild(y); btns.appendChild(n);
      }
      card.appendChild(btns);
    }
    box.appendChild(card);
  }

  function renderTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('#subTabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === ui.tab); });
    $('panelEpisodes').hidden = ui.tab !== 'episodes';
    $('panelFacts').hidden = ui.tab !== 'facts';
    $('panelQuiz').hidden = ui.tab !== 'quiz';
  }

  function renderAll() {
    document.documentElement.style.setProperty('--tc', themeColor(ui.th));
    renderThemes(); renderHero(); renderEpisodes(); renderFacts(); renderQuiz(); renderTabs();
  }

  /* ---------------- vue lecture (transcription) ---------------- */
  function renderReader() {
    var t = curTrack(); if (!t) return;
    var th = D.themes[P.th], art = $('transcript');
    document.documentElement.style.setProperty('--tc', th.color);
    art.innerHTML = '';
    art.appendChild(el('p', 'kicker', th.icon + ' ' + esc(th.title) + ' · ' + (t.kind === 'quiz' ? 'اختبار صوتي' : 'الحلقة ' + (P.tr + 1) + ' من ' + th.tracks.length)));
    var h = el('h2', '', esc(t.title)); h.dataset.seg = 0; h.onclick = function () { gotoSeg(0, true); }; art.appendChild(h);
    t.paras.forEach(function (p, i) {
      var cls = t.kind === 'quiz' ? (i % 2 === 0 ? 'q' : 'a') : '';
      var e = el('p', cls, tx(p)); e.dataset.seg = i + 1;
      e.onclick = function () { gotoSeg(i + 1, true); };
      art.appendChild(e);
    });
    var nav = $('readerNav'); nav.innerHTML = '';
    var prev = th.tracks[P.tr - 1], next = th.tracks[P.tr + 1];
    if (prev) { var bp = el('button', 'btn ghost small', '→ ' + esc(prev.title)); bp.onclick = function () { startTrack(P.th, P.tr - 1, 0, true); }; nav.appendChild(bp); } else nav.appendChild(el('span'));
    if (next) { var bn = el('button', 'btn small', esc(next.title) + ' ←'); bn.onclick = function () { startTrack(P.th, P.tr + 1, 0, true); }; nav.appendChild(bn); }
    renderVoiceWarn();
    highlight(P.seg, false);
  }
  var ANDROID_STEPS = '<ol><li>الإعدادات ← ابحث عن «تحويل النص إلى كلام» (Synthèse vocale / Text-to-speech).</li>' +
    '<li>المحرك المفضل: <b>Google</b> (Services vocaux Google). على سامسونغ: لا تستعمل محرك Samsung.</li>' +
    '<li>اضغط ⚙️ بجانب المحرك ← تثبيت بيانات الصوت ← <b>العربية</b> ← تنزيل.</li>' +
    '<li>اجعل اللغة: العربية، ثم أغلق Chrome تماما وأعد فتح الصفحة.</li></ol>';
  function renderVoiceWarn() {
    var w = $('voiceWarn');
    if (P.mode !== 'tts') { w.hidden = true; return; }
    var html = '';
    if (!synth) html = 'هذا المتصفح لا يدعم القراءة الصوتية. افتح الصفحة في Chrome أو Safari.';
    else if (IS_WEBVIEW) html = '<b>افتح هذه الصفحة في متصفح Chrome</b> (وليس داخل تطبيق آخر): المتصفح المدمج في التطبيقات على أندرويد لا يقرأ إلا بلغة الهاتف، فيقرأ الأرقام فقط.';
    else if (!voices.length) html = '<b>لا يوجد صوت عربي في هذا الهاتف</b>، لذلك تُقرأ الأرقام فقط.' + (IS_ANDROID ? ANDROID_STEPS :
      '<br>آيفون: الإعدادات ← تسهيلات الاستخدام ← المحتوى المنطوق ← الأصوات ← العربية.');
    else if (IS_ANDROID && !store.get('androidOk', false)) html = '<b>هل تسمع الأرقام فقط؟</b> فهذا يعني أن الصوت العربي غير مثبت في محرك القراءة بهاتفك:' + ANDROID_STEPS;
    if (!html) { w.hidden = true; return; }
    w.hidden = false; w.innerHTML = html;
    if (synth && IS_ANDROID && voices.length && !IS_WEBVIEW) {
      var row = el('div', 'warn-btns');
      var t = el('button', 'btn small', 'جرّب الصوت'); t.onclick = function () { $('btnTestVoice').click(); };
      var ok = el('button', 'btn small ghost', 'الصوت العربي يعمل ✓'); ok.onclick = function () { store.set('androidOk', true); w.hidden = true; };
      row.appendChild(t); row.appendChild(ok); w.appendChild(row);
    }
  }
  function highlight(i, scroll) {
    var art = $('transcript');
    var old = art.querySelector('.active'); if (old) old.classList.remove('active');
    var e = art.querySelector('[data-seg="' + i + '"]');
    if (e) {
      e.classList.add('active');
      if (scroll !== false && settings.scroll && !$('viewReader').hidden) {
        var r = e.getBoundingClientRect(), vh = window.innerHeight;
        if (r.top < 90 || r.bottom > vh - 170) e.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }
  function showView(v) {
    ui.view = v;
    $('viewTheme').hidden = v !== 'theme';
    $('viewReader').hidden = v !== 'reader';
    $('themeTabs').hidden = v === 'reader';
  }
  function showReader() {
    if (ui.view !== 'reader') { try { history.pushState({ reader: 1 }, ''); } catch (e) { } }
    showView('reader'); renderReader(); window.scrollTo(0, 0);
    setTimeout(function () { highlight(P.seg); }, 50);
  }
  window.addEventListener('popstate', function () { if (ui.view === 'reader') { showView('theme'); ui.th = P.th >= 0 ? P.th : ui.th; renderAll(); } });

  /* ---------------- lecteur ---------------- */
  function stopAll() {
    P.token++; clearTimeout(P.timer);
    try { audio.pause(); } catch (e) { }
    if (synth) { try { synth.cancel(); } catch (e) { } }
    P.playing = false;
  }
  function startTrack(th, tr, seg, open) {
    stopAll();
    P.th = th; P.tr = tr; P.seg = seg || 0; P.chunk = 0;
    var t = curTrack(), m = mp3For(t);
    P.mode = m ? 'mp3' : 'tts';
    if (m) {
      audio.src = m.file;
      audio.playbackRate = settings.rate;
      if (P.seg) audio.addEventListener('loadedmetadata', function once() { audio.removeEventListener('loadedmetadata', once); audio.currentTime = m.starts[P.seg] || 0; });
    } else { audio.removeAttribute('src'); try { audio.load(); } catch (e) { } }
    ui.th = th; store.set('themeId', D.themes[th].id);
    $('player').hidden = false;
    if (open) showReader(); else renderReader();
    updatePlayer(); renderEpisodes(); renderThemes(); setMediaSession();
    play();
  }
  function play() {
    var t = curTrack(); if (!t) return;
    if (P.mode === 'mp3') {
      audio.playbackRate = settings.rate;
      var pr = audio.play();
      if (pr && pr.catch) pr.catch(function () { P.playing = false; updatePlayer(); });
      P.playing = true;
    } else {
      if (!synth) { showReader(); return; }
      P.playing = true; ttsFrom(P.seg, P.chunk);
    }
    updatePlayer(); renderEpisodes();
  }
  function pause() {
    if (P.mode === 'mp3') audio.pause();
    else { P.token++; clearTimeout(P.timer); try { synth.cancel(); } catch (e) { } }
    P.playing = false; updatePlayer(); renderEpisodes(); saveLast();
  }
  function toggle() { if (!curTrack()) return; P.playing ? pause() : play(); }
  function gotoSeg(i, forcePlay) {
    var t = curTrack(); if (!t) return;
    var n = segsOf(t).length; i = Math.max(0, Math.min(n - 1, i));
    P.seg = i; P.chunk = 0; highlight(i);
    if (P.mode === 'mp3') {
      var m = mp3For(t); if (m) audio.currentTime = m.starts[i] || 0;
      if (forcePlay && !P.playing) play();
    } else if (P.playing) ttsFrom(i, 0);
    else if (forcePlay) play();
    updatePlayer();
  }
  function ttsFrom(seg, chunk) {
    var my = ++P.token; clearTimeout(P.timer);
    try { synth.cancel(); } catch (e) { }
    var t = curTrack(), segs = segsOf(t);
    function step(s, c) {
      if (my !== P.token) return;
      if (s >= segs.length) { trackEnded(); return; }
      if (s !== P.seg || c === 0) { P.seg = s; highlight(s); updatePlayer(); }
      P.seg = s; P.chunk = c;
      var chunks = chunksOf(normalize(segs[s]));
      if (c >= chunks.length) { P.timer = setTimeout(function () { step(s + 1, 0); }, gapAfter(t, s) * 1000 / settings.rate); return; }
      var u = new SpeechSynthesisUtterance(chunks[c]);
      applyVoice(u);
      u.rate = settings.rate;
      var fired = false;
      var next = function () { if (fired) return; fired = true; if (my === P.token) step(s, c + 1); };
      u.onend = next;
      u.onerror = function (e) { if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; next(); };
      synth.speak(u);
    }
    setTimeout(function () { step(seg, chunk); }, 60);
  }
  function trackEnded() {
    var t = curTrack(); if (!t) return;
    done[t.id] = 1; store.set('done', done);
    var th = D.themes[P.th];
    if (settings.autoNext && th.tracks[P.tr + 1]) { startTrack(P.th, P.tr + 1, 0, ui.view === 'reader'); return; }
    P.playing = false; P.seg = 0; P.chunk = 0;
    updatePlayer(); renderThemes(); renderHero(); renderEpisodes();
  }
  function saveLast() { if (P.th >= 0) store.set('last', { id: D.themes[P.th].tracks[P.tr].id, seg: P.seg }); }

  function updatePlayer() {
    var t = curTrack(); if (!t) return;
    var th = D.themes[P.th];
    $('pTheme').textContent = th.icon + ' ' + th.title + (t.kind === 'quiz' ? '' : ' · الحلقة ' + (P.tr + 1));
    $('pTitle').textContent = t.title;
    $('pSource').textContent = P.mode === 'mp3' ? 'MP3' : 'صوت الجهاز';
    $('pPlay').classList.toggle('is-playing', P.playing);
    $('pPlay').setAttribute('aria-label', P.playing ? 'إيقاف مؤقت' : 'تشغيل');
    $('pSpeed').innerHTML = 'السرعة <bdi dir="ltr">' + settings.rate + '×</bdi>';
    var seek = $('pSeek'), n = segsOf(t).length;
    if (P.mode === 'mp3') {
      var d = audio.duration || (mp3For(t) || {}).duration || 0;
      seek.max = d || 1; seek.step = 0.1; if (!seeking) seek.value = audio.currentTime || 0;
      $('pTime').textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
    } else {
      seek.max = n - 1; seek.step = 1; if (!seeking) seek.value = P.seg;
      $('pTime').textContent = 'فقرة ' + P.seg + ' / ' + (n - 1);
    }
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = P.playing ? 'playing' : 'paused'; } catch (e) { } }
  }
  var seeking = false;
  $('pSeek').addEventListener('input', function () { seeking = true; });
  $('pSeek').addEventListener('change', function () {
    seeking = false; var v = parseFloat(this.value);
    if (P.mode === 'mp3') { audio.currentTime = v; } else gotoSeg(Math.round(v), false);
  });

  audio.addEventListener('timeupdate', function () {
    var t = curTrack(); if (!t || P.mode !== 'mp3') return;
    var m = mp3For(t); if (!m) return;
    var ct = audio.currentTime, i = 0;
    for (var k = 0; k < m.starts.length; k++) if (m.starts[k] <= ct + 0.05) i = k;
    if (i !== P.seg) { P.seg = i; highlight(i); if (i % 2 === 0) saveLast(); }
    updatePlayer();
  });
  audio.addEventListener('play', function () { P.playing = true; updatePlayer(); });
  audio.addEventListener('pause', function () { if (P.mode === 'mp3') { P.playing = false; updatePlayer(); renderEpisodes(); } });
  audio.addEventListener('ended', function () { if (P.mode === 'mp3') trackEnded(); });
  audio.addEventListener('loadedmetadata', updatePlayer);
  audio.addEventListener('error', function () {
    // MP3 introuvable → bascule sur la voix de l'appareil
    if (P.mode === 'mp3' && audio.getAttribute('src')) { P.mode = 'tts'; updatePlayer(); if (P.playing) ttsFrom(P.seg, 0); }
  });

  $('pPlay').onclick = toggle;
  $('pPrev').onclick = function () {
    if (P.mode === 'mp3') { var m = mp3For(curTrack()); if (m && audio.currentTime - (m.starts[P.seg] || 0) > 2.5) { gotoSeg(P.seg); return; } }
    gotoSeg(P.seg - 1);
  };
  $('pNext').onclick = function () {
    var t = curTrack(); if (!t) return;
    if (P.seg >= segsOf(t).length - 1) { if (D.themes[P.th].tracks[P.tr + 1]) startTrack(P.th, P.tr + 1, 0, ui.view === 'reader'); return; }
    gotoSeg(P.seg + 1);
  };
  var RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
  $('pSpeed').onclick = function () {
    var i = RATES.indexOf(settings.rate); settings.rate = RATES[(i + 1) % RATES.length]; saveSettings();
    if (P.mode === 'mp3') audio.playbackRate = settings.rate; else if (P.playing) ttsFrom(P.seg, P.chunk);
    updatePlayer();
  };
  $('pOpen').onclick = function () { if (curTrack()) showReader(); };
  $('btnBack').onclick = function () { if (history.state && history.state.reader) history.back(); else { showView('theme'); renderAll(); } };

  function setMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var t = curTrack(); if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: D.themes[P.th].title, album: 'مراجعة – مشروع قانون المالية 2027' });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('previoustrack', function () { $('pPrev').click(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { $('pNext').click(); });
      navigator.mediaSession.setActionHandler('seekbackward', function () { if (P.mode === 'mp3') audio.currentTime = Math.max(0, audio.currentTime - 10); });
      navigator.mediaSession.setActionHandler('seekforward', function () { if (P.mode === 'mp3') audio.currentTime += 10; });
    } catch (e) { }
  }

  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') $('pNext').click();
    else if (e.key === 'ArrowRight') $('pPrev').click();
  });
  window.addEventListener('pagehide', saveLast);

  /* ---------------- sous-onglets ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('#subTabs button'), function (b) {
    b.onclick = function () { ui.tab = b.dataset.tab; renderTabs(); };
  });

  /* ---------------- réglages ---------------- */
  function renderVoiceSelect() {
    var sel = $('voiceSel'); if (!sel) return;
    sel.innerHTML = '';
    if (!voices.length) {
      sel.appendChild(el('option', '', 'لا يوجد صوت عربي'));
      $('voiceHint').textContent = synth ? 'ثبّت صوتا عربيا في إعدادات الهاتف (تحويل النص إلى كلام / المحتوى المنطوق) ثم أعد فتح الصفحة.' : 'هذا المتصفح لا يدعم القراءة الصوتية.';
      return;
    }
    voices.forEach(function (v) {
      var o = el('option', '', esc(v.name + ' (' + v.lang + ')')); o.value = v.voiceURI;
      if (voice && v.voiceURI === voice.voiceURI) o.selected = true;
      sel.appendChild(o);
    });
    $('voiceHint').textContent = voices.length + ' صوت عربي متاح. الأصوات المسماة Google أو Enhanced تكون عادة أوضح.';
  }
  $('voiceSel').onchange = function () {
    voice = voices.filter(function (v) { return v.voiceURI === this.value; }, this)[0] || voice;
    settings.voiceURI = voice ? voice.voiceURI : ''; saveSettings();
  };
  $('btnTestVoice').onclick = function () {
    if (!synth) return;
    synth.cancel();
    var u = new SpeechSynthesisUtterance(normalize('هذا اختبار للصوت: سُجّل 4.786 قتيلا سنة 2025، بارتفاع 18,9%.'));
    applyVoice(u);
    u.rate = settings.rate; synth.speak(u);
  };
  $('optAutoNext').onchange = function () { settings.autoNext = this.checked; saveSettings(); };
  $('optScroll').onchange = function () { settings.scroll = this.checked; saveSettings(); };
  Array.prototype.forEach.call(document.querySelectorAll('input[name=source]'), function (r) {
    r.onchange = function () {
      settings.source = this.value; saveSettings();
      if (curTrack()) { var wasPlaying = P.playing; var s = P.seg; startTrack(P.th, P.tr, s, ui.view === 'reader'); if (!wasPlaying) pause(); }
      renderAll();
    };
  });
  $('btnReset').onclick = function () {
    var btn = this;
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'اضغط مرة أخرى للتأكيد'; setTimeout(function () { delete btn.dataset.armed; btn.textContent = 'مسح التقدم'; }, 3000); return; }
    delete btn.dataset.armed; btn.textContent = 'تم المسح ✓';
    done = {}; store.set('done', done); store.set('last', null); renderAll();
  };
  $('btnSettings').onclick = function () {
    document.querySelector('input[name=source][value="' + settings.source + '"]').checked = true;
    $('optAutoNext').checked = settings.autoNext; $('optScroll').checked = settings.scroll;
    var n = manifest && manifest.tracks ? Object.keys(manifest.tracks).length : 0;
    $('mp3Status').textContent = n ? (n + ' حلقة متوفرة بصيغة MP3' + (manifest.voice && manifest.voice !== 'dummy' ? ' (الصوت: ' + manifest.voice + ')' : '') + '.') : 'لا توجد ملفات MP3 بعد: يتم استعمال صوت الجهاز. (انظر ملف README لتوليدها.)';
    $('offlineBox').hidden = !(n && 'caches' in window);
    loadVoices();
    var d = $('dlgSettings'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  };
  $('btnOffline').onclick = function () {
    var files = Object.keys(manifest.tracks).map(function (k) { return manifest.tracks[k].file; });
    var st = $('offlineStatus'), k = 0;
    caches.open('rev27-audio').then(function (c) {
      return files.reduce(function (p, f) {
        return p.then(function () { return fetch(f).then(function (r) { if (r.ok) return c.put(f, r); }).then(function () { k++; st.textContent = 'تم تحميل ' + k + ' من ' + files.length; }); });
      }, Promise.resolve());
    }).then(function () { st.textContent = 'تم: كل الحلقات متاحة دون إنترنت على هذا الجهاز.'; })
      .catch(function () { st.textContent = 'تعذّر التحميل. تحقق من الاتصال وأعد المحاولة.'; });
  };

  /* ---------------- démarrage ---------------- */
  $('sourceNote').textContent = 'المصدر: ' + D.meta.source + '.';
  renderAll();
  fetch('audio/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (m) { if (m && m.tracks && Object.keys(m.tracks).length) { manifest = m; renderAll(); } })
    .catch(function () { });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
})();
