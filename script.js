'use strict';

/* =========================================================
   Hue Hunter — Season 2 / 色相識別テスト
   ルール: 1枚だけ色相の違うタイルを選ぶ。正解で残り時間が回復し、
   スコアに応じてグリッドが拡大、色差が縮む。誤答か時間切れで終了。
   ========================================================= */

// --- 計測パラメータ（調整はここだけで完結する） ------------

const SEASON = 2;
const COLLECTION = 'rankings_v2';
const K_BEST = 'hueHunter_s2_best';
const K_NAME = 'hueHunter_v5_name';
const K_SOUND = 'hueHunter_sound';
const K_SURROUND = 'hueHunter_surround';

const TIME_START = 12;
const TOP_LIMIT = 5;
const FULL_LIMIT = 100;
const NAME_MAX = 8;

// スコア → グリッド一辺。2×2 の肩慣らしから 10×10 まで 9 段階で細かくなる。
const GRID_STEPS = [
    { from: 62, size: 10 },
    { from: 48, size: 9 },
    { from: 36, size: 8 },
    { from: 26, size: 7 },
    { from: 18, size: 6 },
    { from: 12, size: 5 },
    { from: 7,  size: 4 },
    { from: 3,  size: 3 },
    { from: 0,  size: 2 }
];

const gridSizeFor  = (score) => GRID_STEPS.find((s) => score >= s.from).size;
const timeBonusFor = (score) => Math.max(1.4, 3.0 * Math.pow(0.985, score));
const timeCapFor   = (score) => Math.max(7, 15 * Math.pow(0.99, score));
// 色相差: 18° から 1.2° へ逓減。下限 1.2° は hsl(h,80%,50%) で RGB 約 4 段階に
// 相当し、8bit 表示で表現できる下限に近い。
const hueDiffFor   = (score) => Math.max(1.2, 18 * Math.pow(0.970, score));

/**
 * 色相帯ごとの難易度補正（マクアダム楕円 + 生理光学）。
 * 人間の色相弁別能は橙〜黄で最も鋭く、緑帯で最も鈍い。
 * 鈍い帯ほど色差を広げないと体感難度が揃わないため倍率を掛ける。
 */
function sensitivityAt(h) {
    if (h >= 80 && h <= 165) return 1.8;   // 緑
    if (h >= 166 && h <= 210) return 1.3;  // シアン
    if (h >= 211 && h <= 280) return 1.2;  // 青〜紫
    if (h >= 320 || h <= 20) return 1.15;  // 赤〜ピンク
    return 1.0;                            // 橙〜黄（基準）
}

const SURROUND_BG = { dark: '#0a0a0a', gray: '#767676', light: '#ededed' };

// --- 状態 ---------------------------------------------------

const state = {
    score: 0,
    best: parseInt(localStorage.getItem(K_BEST), 10) || 0,
    n: 2,
    maxN: 2,
    answer: -1,
    delta: null,
    minDelta: null,
    lastPick: null,
    colors: null,      // 現在の盤面の { base, odd }（結果画面の見本に使う）

    timeLeft: TIME_START,
    timeCap: TIME_START,
    lastFrame: 0,
    raf: 0,

    running: false,
    paused: false,
    over: false,
    peeking: false,
    cause: 'miss',

    user: null,
    guest: false,
    loggingIn: false,

    sound: localStorage.getItem(K_SOUND) !== 'off',
    surround: localStorage.getItem(K_SURROUND) || 'dark'
};

const $ = (id) => document.getElementById(id);
const el = {
    score: $('score'), best: $('best'),
    stage: $('stage'), board: $('board'), ring: $('ring-fill'),
    meta: $('meta'), metaGrid: $('meta-grid'), metaDelta: $('meta-delta'), metaTime: $('meta-time'),
    title: $('title'), report: $('report'), leaderboard: $('leaderboard'),
    countdown: $('countdown'), cdValue: $('countdown-value'), cdLabel: $('countdown-label'),
    pause: $('pause'), settings: $('settings'),
    peekBack: $('btn-peek-back'), steps: $('steps'), bonus: $('bonus'),
    cdArc: $('cd-arc')
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad3 = (n) => String(n).padStart(3, '0');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const showLayer = (node, on) => node.classList.toggle('on', on);
// 画面モード。プレイ中は設定ボタンなど盤面以外の操作子を引っ込める
const setMode = (mode) => { document.body.dataset.mode = mode; };
const setHidden = (node, hidden) => { if (node) node.hidden = hidden; };

// --- サウンド -----------------------------------------------

let ac = null;

function blip(freq, dur, type = 'sine', vol = 0.045) {
    if (!state.sound) return;
    try {
        if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(vol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(g).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur);
    } catch (e) { /* 音を出せない環境は無視 */ }
}

const sfx = {
    hit:    () => blip(1180, 0.05, 'sine', 0.04),
    miss:   () => { blip(196, 0.09, 'square', 0.05); setTimeout(() => blip(147, 0.26, 'square', 0.045), 80); },
    expire: () => { blip(392, 0.1, 'sine', 0.04); setTimeout(() => blip(262, 0.32, 'sine', 0.04), 110); },
    warn:   () => blip(1560, 0.035, 'sine', 0.025),
    count:  (last) => blip(last ? 1320 : 660, 0.07, 'sine', 0.035),
    record: () => [0, 90, 180].forEach((d, i) => setTimeout(() => blip(784 + i * 196, 0.12, 'sine', 0.04), d))
};

function buzz(pattern) {
    if (state.sound && navigator.vibrate) navigator.vibrate(pattern);
}

// --- 測定環境（周辺色）とサウンドの設定 ---------------------

function applySurround(name) {
    state.surround = SURROUND_BG[name] ? name : 'dark';
    document.documentElement.setAttribute('data-surround', state.surround);
    $('meta-theme-color').setAttribute('content', SURROUND_BG[state.surround]);
    localStorage.setItem(K_SURROUND, state.surround);
    syncSegments();
}

function applySound(on) {
    state.sound = on;
    localStorage.setItem(K_SOUND, on ? 'on' : 'off');
    syncSegments();
}

function syncSegments() {
    $('seg-surround').querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.surround === state.surround));
    });
    $('seg-sound').querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String((b.dataset.sound === 'on') === state.sound));
    });
}

// --- 認証 ---------------------------------------------------

window.onAuthReady = function (user) {
    if (user && !state.guest) {
        state.user = user;
        if (el.title.classList.contains('on')) {
            syncCloud().then(() => {
                paintBest();
                openSetup(user.displayName || 'PLAYER');
            });
        }
    } else if (!user) {
        state.user = null;
    }
    paintAuthState();
};

async function login() {
    if (state.loggingIn) return;
    state.loggingIn = true;
    const btns = [$('btn-login'), $('btn-login-sync')];
    btns.forEach((b) => { if (b) b.disabled = true; });

    try {
        const provider = new window.fb.GoogleAuthProvider();
        const result = await window.fb.signInWithPopup(window.fb.auth, provider);
        state.user = result.user;
        state.guest = false;

        await syncCloud();
        paintBest();
        openSetup(state.user.displayName || 'PLAYER');

        if (state.over && state.score > 0 && state.score >= state.best) {
            await saveRecord();
            setHidden($('btn-login-sync'), true);
            loadBrief();
        }
        paintAuthState();
    } catch (e) {
        console.error('login failed', e);
        alert('ログインに失敗しました。通信環境を確認してください。');
    } finally {
        state.loggingIn = false;
        btns.forEach((b) => { if (b) b.disabled = false; });
    }
}

async function signOut() {
    try { await window.fb.signOut(window.fb.auth); } catch (e) { /* noop */ }
    state.user = null;
    state.guest = false;
    setHidden($('pane-setup'), true);
    setHidden($('pane-auth'), false);
    paintAuthState();
}

async function syncCloud() {
    if (!state.user) return;
    try {
        const snap = await window.fb.getDoc(window.fb.doc(window.fb.db, COLLECTION, state.user.uid));
        if (!snap.exists()) return;
        const d = snap.data();
        if (typeof d.score === 'number' && d.score > state.best) {
            state.best = d.score;
            localStorage.setItem(K_BEST, String(state.best));
        }
        if (d.name) localStorage.setItem(K_NAME, d.name);
    } catch (e) {
        console.error('sync failed', e);
    }
}

async function saveRecord() {
    if (!state.user) return;
    const name = (localStorage.getItem(K_NAME) || 'Unknown').slice(0, NAME_MAX);
    try {
        await window.fb.setDoc(window.fb.doc(window.fb.db, COLLECTION, state.user.uid), {
            name,
            score: state.score,
            minDelta: state.minDelta === null ? 0 : Math.round(state.minDelta * 10) / 10,
            season: SEASON,
            timestamp: window.fb.serverTimestamp()
        });
    } catch (e) {
        console.error('save failed', e);
    }
}

function paintAuthState() {
    const node = $('auth-state');
    if (!node) return;
    node.textContent = state.user ? 'SYNCED' : 'GUEST';
}

function continueAsGuest() {
    state.guest = true;
    state.user = null;
    openSetup('GUEST');
    paintAuthState();
}

function openSetup(who) {
    setHidden($('pane-auth'), true);
    setHidden($('pane-setup'), false);
    $('welcome').textContent = who;
    setHidden($('btn-signout'), state.guest || !state.user);
    const saved = localStorage.getItem(K_NAME);
    if (saved) $('name-input').value = saved;
}

// --- ラウンド進行 -------------------------------------------

function beginFromTitle() {
    const input = $('name-input');
    const err = $('name-error');
    const name = input.value.trim().slice(0, NAME_MAX);

    if (!name) {
        err.textContent = '表示名を入力してください';
        setHidden(err, false);
        input.focus();
        return;
    }
    setHidden(err, true);
    localStorage.setItem(K_NAME, name);

    showLayer(el.title, false);
    setTimeout(startRound, 320);
}

function quitToTitle() {
    showLayer(el.pause, false);
    state.paused = false;
    state.running = false;
    state.over = true;
    stopClock();
    el.board.replaceChildren();
    setMode('title');
    showLayer(el.title, true);
}

function startRound() {
    // 計器の初期化はカウントダウンの「前」に済ませる。
    // カウントダウン中は盤面を空・リングを満タンにしておき、
    // GO と同時にタイルを出して計時を始める。
    resetRound();
    setMode('play');
    countdown(() => {
        drawBoard();
        paintMeta();
        startClock();
    });
}

function countdown(done) {
    if (reduceMotion) { done(); return; }
    const seq = ['3', '2', '1'];
    let i = 0;
    showLayer(el.countdown, true);
    el.cdLabel.textContent = 'READY';

    const beat = (frac) => {
        el.cdValue.classList.remove('beat');
        void el.cdValue.offsetWidth;
        el.cdValue.classList.add('beat');
        el.cdArc.style.strokeDashoffset = String(1 - frac);
    };
    el.cdArc.style.transition = 'none';
    el.cdArc.style.strokeDashoffset = '1';
    void el.cdArc.getBoundingClientRect();
    el.cdArc.style.transition = '';

    const step = () => {
        if (i >= seq.length) {
            el.cdValue.textContent = 'GO';
            el.cdLabel.textContent = 'MEASURING';
            beat(1);
            sfx.count(true);
            setTimeout(() => { showLayer(el.countdown, false); done(); }, 420);
            return;
        }
        el.cdValue.textContent = seq[i];
        beat((i + 1) / (seq.length + 1));
        sfx.count(false);
        i++;
        setTimeout(step, 560);
    };
    step();
}

function resetRound() {
    state.score = 0;
    state.n = 2;
    state.maxN = 2;
    state.delta = null;
    state.minDelta = null;
    state.lastPick = null;
    state.colors = null;
    state.over = false;
    state.peeking = false;
    state.cause = 'miss';
    // 上限と残り時間を揃える。ずれているとリングが満タン未満から始まる。
    state.timeCap = TIME_START;
    state.timeLeft = TIME_START;

    el.board.classList.remove('revealed');
    el.board.replaceChildren();
    el.board.style.setProperty('--n', 2);

    paintScore();
    paintMeta();
    paintClock();
}

// --- 盤面 ---------------------------------------------------

function drawBoard() {
    const n = gridSizeFor(state.score);
    state.n = n;
    state.maxN = Math.max(state.maxN, n);

    const total = n * n;
    const hue = Math.floor(Math.random() * 360);
    const delta = hueDiffFor(state.score) * sensitivityAt(hue);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const oddHue = (hue + delta * dir + 360) % 360;

    state.delta = delta;
    state.answer = Math.floor(Math.random() * total);

    const base = `hsl(${hue}, 80%, 50%)`;
    const odd = `hsl(${oddHue.toFixed(2)}, 80%, 50%)`;
    state.colors = { base, odd };

    el.board.style.setProperty('--n', n);
    el.board.classList.remove('revealed');
    el.board.replaceChildren();

    // 直前にタップした位置から波紋状に現れる（因果が視覚的につながる）
    const origin = state.lastPick || { r: (n - 1) / 2, c: (n - 1) / 2 };
    const frag = document.createDocumentFragment();

    for (let i = 0; i < total; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.setAttribute('role', 'gridcell');
        tile.style.backgroundColor = (i === state.answer) ? odd : base;

        if (!reduceMotion) {
            const r = Math.floor(i / n);
            const c = i % n;
            const dist = Math.abs(r - origin.r) + Math.abs(c - origin.c);
            tile.style.animationDelay = `${dist * (0.15 / n)}s`;
        }
        if (i === state.answer) tile.classList.add('answer');

        tile.addEventListener('click', () => {
            if (state.over || state.paused || !state.running) return;
            state.lastPick = { r: Math.floor(i / n), c: i % n };
            (i === state.answer) ? onHit() : finish('miss');
        });

        frag.appendChild(tile);
    }
    el.board.appendChild(frag);
}

function onHit() {
    // いま識別できた色差を記録する（これがテストの測定結果）
    state.minDelta = (state.minDelta === null) ? state.delta : Math.min(state.minDelta, state.delta);
    state.score++;

    state.timeCap = timeCapFor(state.score);
    const before = state.timeLeft;
    state.timeLeft = Math.min(state.timeCap, state.timeLeft + timeBonusFor(state.score));
    flashBonus(state.timeLeft - before);

    sfx.hit();
    buzz(10);
    const prevN = state.n;
    drawBoard();
    paintScore();
    paintMeta();
    if (state.n !== prevN) el.stage.classList.add('levelup');
}

function flashBonus(sec) {
    if (sec < 0.05) return;
    el.bonus.textContent = `+${sec.toFixed(1)}`;
    el.bonus.classList.remove('on');
    void el.bonus.offsetWidth;
    el.bonus.classList.add('on');
}

function finish(cause) {
    if (state.over) return;
    state.over = true;
    state.running = false;
    state.cause = cause;
    stopClock();
    setMode('reveal');

    if (cause === 'expire') { sfx.expire(); buzz([30, 50, 30]); }
    else { sfx.miss(); buzz([50, 40, 50]); }

    el.board.classList.add('revealed');
    if (cause === 'miss' && state.lastPick) {
        const picked = el.board.children[state.lastPick.r * state.n + state.lastPick.c];
        if (picked) picked.classList.add('picked');
    }

    const isBest = state.score > state.best;
    if (isBest) {
        state.best = state.score;
        localStorage.setItem(K_BEST, String(state.best));
        paintBest();
        if (!state.guest && state.user) saveRecord();
    }

    setTimeout(() => openReport(isBest), 950);
}

// --- タイマー -----------------------------------------------

let lastWarnSecond = -1;

function startClock() {
    state.running = true;
    state.paused = false;
    state.lastFrame = performance.now();
    state.raf = requestAnimationFrame(tick);
}

function stopClock() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
}

function tick(now) {
    if (!state.running || state.paused) return;

    state.timeLeft -= (now - state.lastFrame) / 1000;
    state.lastFrame = now;

    if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        paintClock();
        finish('expire');
        return;
    }

    const sec = Math.ceil(state.timeLeft);
    if (state.timeLeft <= 3 && sec !== lastWarnSecond) {
        lastWarnSecond = sec;
        sfx.warn();
    } else if (state.timeLeft > 3) {
        lastWarnSecond = -1;
    }

    paintClock();
    state.raf = requestAnimationFrame(tick);
}

function pause() {
    if (!state.running || state.paused || state.over) return;
    state.paused = true;
    stopClock();
    showLayer(el.settings, false);
    showLayer(el.pause, true);
}

function resume() {
    if (!state.paused) return;
    showLayer(el.pause, false);
    state.paused = false;
    state.lastFrame = performance.now();
    state.raf = requestAnimationFrame(tick);
}

// --- 計器の描画 ---------------------------------------------

function paintScore() {
    el.score.textContent = pad3(state.score);
    if (state.score > 0 && !reduceMotion) {
        el.score.classList.remove('bump');
        void el.score.offsetWidth;
        el.score.classList.add('bump');
    }
}
function paintBest()  { el.best.textContent = pad3(state.best); }

function paintMeta() {
    el.metaGrid.textContent = `${state.n}×${state.n}`;
    // グリッド段階のピップ。現在の段階だけ伸ばし、通過済みは塗る
    const idx = GRID_STEPS.length - 1 - GRID_STEPS.findIndex((s) => s.size === state.n);
    [...el.steps.children].forEach((pip, i) => {
        pip.classList.toggle('done', i < idx);
        pip.classList.toggle('now', i === idx);
    });
    el.metaDelta.textContent = state.delta === null ? 'Δ —' : `Δ ${state.delta.toFixed(1)}°`;
}

function paintClock() {
    const ratio = Math.max(0, Math.min(1, state.timeLeft / state.timeCap));
    el.ring.style.strokeDashoffset = String(1 - ratio);
    el.metaTime.textContent = state.timeLeft.toFixed(2);
    const low = state.timeLeft <= 3;
    el.stage.classList.toggle('low', low);
    el.meta.classList.toggle('low', low);
}

// --- ランキング ---------------------------------------------

function rowHtml(pos, name, score, self, minDelta) {
    const podium = pos <= 3 ? ` podium p${pos}` : '';
    const delta = (minDelta === undefined) ? ''
        : `<span class="rank-delta">${typeof minDelta === 'number' && minDelta > 0 ? minDelta.toFixed(1) + '°' : '—'}</span>`;
    return `<div class="rank-row${self ? ' self' : ''}${podium}">
                <span class="rank-pos">${String(pos).padStart(2, '0')}</span>
                <span class="rank-who">${escapeHtml(name)}${self ? '<i class="you">YOU</i>' : ''}</span>
                ${delta}
                <span class="rank-val">${pad3(score)}</span>
            </div>`;
}

async function loadBrief() {
    const list = $('rank-brief');
    const fb = window.fb;

    try {
        const snap = await fb.getDocs(fb.query(
            fb.collection(fb.db, COLLECTION),
            fb.orderBy('score', 'desc'),
            fb.limit(TOP_LIMIT)
        ));

        let html = '';
        let pos = 1;
        let inTop = false;

        snap.forEach((d) => {
            const data = d.data();
            const self = !!state.user && d.id === state.user.uid;
            if (self) inTop = true;
            html += rowHtml(pos++, data.name || '---', data.score, self);
        });

        list.innerHTML = html || '<p class="rank-msg">NO RECORDS YET</p>';

        // 圏外なら自分の順位だけカウントクエリで取る（全件走査しない）
        if (state.user && !inTop) {
            const me = await myRank();
            if (me) {
                list.insertAdjacentHTML('beforeend',
                    '<div class="rank-gap"></div>' + rowHtml(me.pos, me.name, me.score, true));
            }
        }
    } catch (e) {
        console.error('ranking failed', e);
        list.innerHTML = '<p class="rank-msg">RANKING UNAVAILABLE</p>';
    }
}

async function myRank() {
    const fb = window.fb;
    try {
        const mine = await fb.getDoc(fb.doc(fb.db, COLLECTION, state.user.uid));
        if (!mine.exists()) return null;
        const d = mine.data();
        const above = await fb.getCountFromServer(fb.query(
            fb.collection(fb.db, COLLECTION),
            fb.where('score', '>', d.score)
        ));
        return { pos: above.data().count + 1, name: d.name || '---', score: d.score };
    } catch (e) {
        console.error('rank lookup failed', e);
        return null;
    }
}

async function openLeaderboard() {
    const list = $('rank-full');
    const fb = window.fb;

    showLayer(el.leaderboard, true);
    list.innerHTML = '<p class="rank-msg">LOADING</p>';

    try {
        const snap = await fb.getDocs(fb.query(
            fb.collection(fb.db, COLLECTION),
            fb.orderBy('score', 'desc'),
            fb.limit(FULL_LIMIT)
        ));

        let html = '';
        let count = 0;
        snap.forEach((d) => {
            const data = d.data();
            const self = !!state.user && d.id === state.user.uid;
            html += rowHtml(++count, data.name || '---', data.score, self, data.minDelta ?? null);
        });

        if (count === 0) html = '<p class="rank-msg">NO RECORDS YET</p>';
        else if (count >= FULL_LIMIT) html += `<p class="rank-msg">TOP ${FULL_LIMIT} SHOWN</p>`;
        list.innerHTML = html;
    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="rank-msg">RANKING UNAVAILABLE</p>';
    }
}

// --- 計測結果 -----------------------------------------------

function openReport(isBest) {
    state.peeking = false;
    setMode('report');
    el.peekBack.classList.remove('on');

    setHidden($('badge-new'), !isBest);
    if (isBest) sfx.record();

    const g = gradeFor(state.score);
    $('r-score').textContent = pad3(state.score);
    $('r-grade').textContent = g.title;
    $('r-note').textContent = g.note;
    $('r-rank').textContent = `RANK ${g.rank} / ${GRADES.length}`;
    drawDial(state.score);
    paintSwatch();
    $('r-delta').textContent = state.minDelta === null ? '—' : `${state.minDelta.toFixed(1)}°`;
    $('r-grid').textContent = `${state.maxN}×${state.maxN}`;
    $('r-best').textContent = pad3(state.best);
    $('r-cause').textContent = state.cause === 'expire' ? '時間切れ' : '誤答';

    setHidden($('btn-login-sync'), !!state.user);
    paintAuthState();
    loadBrief();

    showLayer(el.report, true);
}

// 称号。絵文字は有彩色なので使わず、計器ダイヤルの目盛りで段位を示す
const GRADES = [
    { from: 0,   title: '一般市民',     note: 'まだ見ぬ色彩が君を待っている。' },
    { from: 10,  title: '見習い画家',   note: '才能の片鱗。迷宮を抜ける鍵を既に手にしている。' },
    { from: 20,  title: '色彩ソムリエ', note: '違いの分かる瞳。色の個性を楽しみ始めた選ばれし者。' },
    { from: 35,  title: '蒼穹の鷹',     note: '鋭い。わずかな色彩の揺らぎを見逃さない観察眼。' },
    { from: 55,  title: '絶対色感',     note: '一点の濁りも逃さないプロの瞳。' },
    { from: 75,  title: '聖域の色彩',   note: '人間卒業。色の粒子が放つ微細な鼓動を捉えている。' },
    { from: 90,  title: '色彩の特異点', note: 'デバイスの限界を超え、色の法則を書き換えた。' },
    { from: 100, title: '神の目',       note: '真理の到達者。色彩の深淵を見通す、神の領域。' }
];
const DIAL_MAX = 100;

function gradeFor(score) {
    let i = GRADES.length - 1;
    while (i > 0 && score < GRADES[i].from) i--;
    return { ...GRADES[i], rank: i + 1 };
}

// --- イラスト（SVG を手続き的に描く） ------------------------

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const node = document.createElementNS(SVGNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
}
const polar = (cx, cy, r, deg) => {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
// 円環の扇形 1 片（r0〜r1、a0〜a1 度）
function sectorPath(cx, cy, r0, r1, a0, a1) {
    const [x0, y0] = polar(cx, cy, r1, a0);
    const [x1, y1] = polar(cx, cy, r1, a1);
    const [x2, y2] = polar(cx, cy, r0, a1);
    const [x3, y3] = polar(cx, cy, r0, a0);
    const large = (a1 - a0) > 180 ? 1 : 0;
    const f = (n) => n.toFixed(2);
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}` +
           `L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/**
 * タイトルの「色相の虹彩」。色相環を 4 重のタイル環で描き、
 * そのうち 1 片だけ色相をずらしてある（ゲームそのものの縮図）。
 * 彩度を持つのはタイトル画面のこの図だけ。
 */
function buildIris() {
    const host = $('iris');
    const C = 150;
    const svg = svgEl('svg', { viewBox: '0 0 300 300', class: 'iris-svg' });
    const rings = [
        { r0: 58,  r1: 76,  n: 24, l: 50 },
        { r0: 80,  r1: 100, n: 36, l: 54 },
        { r0: 104, r1: 124, n: 48, l: 58 },
        { r0: 128, r1: 142, n: 60, l: 62 }
    ];
    const gapDeg = (r) => 1.6 * 100 / r;   // 半径によらず見かけの溝幅を揃える
    const oddRing = 2;
    const oddIdx = Math.floor(Math.random() * rings[oddRing].n);

    const spin = svgEl('g', { class: 'iris-spin' });
    rings.forEach((ring, ri) => {
        const g = svgEl('g', { class: `iris-ring iris-ring-${ri}` });
        const step = 360 / ring.n;
        const offset = ri % 2 ? step / 2 : 0;
        for (let i = 0; i < ring.n; i++) {
            const a0 = offset + i * step + gapDeg(ring.r1) / 2;
            const a1 = offset + (i + 1) * step - gapDeg(ring.r1) / 2;
            let hue = (offset + (i + 0.5) * step) % 360;
            const isOdd = ri === oddRing && i === oddIdx;
            if (isOdd) hue = (hue + 26) % 360;
            const path = svgEl('path', {
                d: sectorPath(C, C, ring.r0, ring.r1, a0, a1),
                fill: `hsl(${hue.toFixed(1)}, 80%, ${ring.l}%)`,
                class: isOdd ? 'iris-seg iris-odd' : 'iris-seg'
            });
            path.style.setProperty('--d', `${(ri * 0.08 + (i / ring.n) * 0.7).toFixed(3)}s`);
            g.appendChild(path);
        }
        spin.appendChild(g);
    });
    svg.appendChild(spin);

    // 瞳孔の照準（無彩色）
    const reticle = svgEl('g', { class: 'iris-reticle' });
    reticle.appendChild(svgEl('circle', { cx: C, cy: C, r: 46 }));
    reticle.appendChild(svgEl('circle', { cx: C, cy: C, r: 2.2, class: 'iris-pupil' }));
    [0, 90, 180, 270].forEach((deg) => {
        const [xa, ya] = polar(C, C, 30, deg);
        const [xb, yb] = polar(C, C, 40, deg);
        reticle.appendChild(svgEl('line', { x1: xa, y1: ya, x2: xb, y2: yb }));
    });
    for (let d = 0; d < 360; d += 10) {
        const long = d % 30 === 0;
        const [xa, ya] = polar(C, C, 50, d);
        const [xb, yb] = polar(C, C, long ? 55 : 52.5, d);
        reticle.appendChild(svgEl('line', { x1: xa, y1: ya, x2: xb, y2: yb, class: 'iris-tick' }));
    }
    svg.appendChild(reticle);
    host.appendChild(svg);

    // 小さな遊び: 違う 1 片を見つけてタップすると印が付く
    const odd = svg.querySelector('.iris-odd');
    odd.addEventListener('click', () => {
        host.classList.add('found');
        const hint = $('iris-hint');
        hint.textContent = 'FOUND — その目なら、きっと遠くまで行けます';
        hint.classList.add('found');
        sfx.hit();
    });
}

/**
 * 結果の計器ダイヤル（無彩色）。外周 100 目盛りのうち score 分が点灯し、
 * 称号の境目には長い目盛りと段位の番号が付く。
 */
function drawDial(score) {
    const svg = $('dial-svg');
    svg.replaceChildren();
    const C = 120;
    const START = -135, SWEEP = 270;           // 下を開けた 270° の計器
    const angle = (v) => START + SWEEP * Math.min(1, v / DIAL_MAX);

    const ticks = svgEl('g', { class: 'dial-ticks' });
    for (let v = 0; v <= DIAL_MAX; v++) {
        const major = GRADES.some((g) => g.from === v);
        const a = angle(v);
        const [xa, ya] = polar(C, C, major ? 94 : 99, a);
        const [xb, yb] = polar(C, C, 106, a);
        const lit = v <= score;
        const line = svgEl('line', {
            x1: xa, y1: ya, x2: xb, y2: yb,
            class: `dial-tick${major ? ' major' : ''}${lit ? ' lit' : ''}`
        });
        if (lit && !reduceMotion) line.style.animationDelay = `${(v / DIAL_MAX) * 0.9 + 0.15}s`;
        ticks.appendChild(line);
    }
    svg.appendChild(ticks);

    // 段位の番号
    GRADES.forEach((g, i) => {
        const [x, y] = polar(C, C, 82, angle(g.from));
        const t = svgEl('text', {
            x, y, class: `dial-num${score >= g.from ? ' lit' : ''}`,
            'text-anchor': 'middle', 'dominant-baseline': 'central'
        });
        t.textContent = String(i + 1);
        svg.appendChild(t);
    });

    // 針（現在値）
    const [nx, ny] = polar(C, C, 112, angle(score));
    const [mx, my] = polar(C, C, 88, angle(score));
    svg.appendChild(svgEl('line', { x1: mx, y1: my, x2: nx, y2: ny, class: 'dial-needle' }));
    const [dx, dy] = polar(C, C, 117, angle(score));
    svg.appendChild(svgEl('circle', { cx: dx, cy: dy, r: 2.6, class: 'dial-needle-dot' }));

    // 内側の細い円
    svg.appendChild(svgEl('circle', { cx: C, cy: C, r: 70, class: 'dial-inner' }));
}

// 最後の盤面の 2 色を並べる。誤答・時間切れなら「見分けられなかった色差」
function paintSwatch() {
    const box = $('swatch');
    if (!state.colors) { box.hidden = true; return; }
    box.hidden = false;
    $('sw-base').style.backgroundColor = state.colors.base;
    $('sw-odd').style.backgroundColor = state.colors.odd;
    $('sw-key').textContent = state.cause === 'expire' ? '時間切れになった色差' : '見分けられなかった色差';
    $('sw-val').textContent = `Δ ${state.delta.toFixed(1)}°`;
}

function buildSteps() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < GRID_STEPS.length; i++) frag.appendChild(document.createElement('i'));
    el.steps.appendChild(frag);
}

function peek() {
    state.peeking = true;
    setMode('peek');
    showLayer(el.report, false);
    setTimeout(() => el.peekBack.classList.add('on'), 300);
}

function backFromPeek() {
    el.peekBack.classList.remove('on');
    setMode('report');
    showLayer(el.report, true);
}

function retry() {
    showLayer(el.report, false);
    setTimeout(startRound, 320);
}

// --- アプリとしてインストール（PWA） -------------------------

const ICON_SHARE = '<svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17"/></svg>';
const ICON_PLUS  = '<svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/></svg>';

let deferredInstall = null;   // Chrome / Edge の beforeinstallprompt

const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Safari は beforeinstallprompt を出さないので、手順を案内する
function safariKind() {
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (iOS) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios';
    if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'mac';
    return null;
}

function paintInstall() {
    const show = !isStandalone() && (deferredInstall !== null || safariKind() !== null);
    setHidden($('btn-install'), !show);
}

async function install() {
    if (deferredInstall) {
        deferredInstall.prompt();
        await deferredInstall.userChoice.catch(() => null);
        deferredInstall = null;
        paintInstall();
        return;
    }
    const kind = safariKind();
    const steps = {
        ios: [
            `画面下（iPad は右上）の ${ICON_SHARE} <b>共有</b> をタップ`,
            `${ICON_PLUS} <b>ホーム画面に追加</b> を選ぶ`,
            '右上の <b>追加</b> をタップ'
        ],
        'ios-other': [
            `アドレスバーの ${ICON_SHARE} <b>共有</b> をタップ`,
            `${ICON_PLUS} <b>ホーム画面に追加</b> を選ぶ`,
            '見つからない場合は Safari で開き直してください'
        ],
        mac: [
            `ツールバーの ${ICON_SHARE} <b>共有</b>、またはメニューの <b>ファイル</b> を開く`,
            '<b>Dock に追加</b> を選ぶ',
            '<b>追加</b> をクリック'
        ]
    }[kind] || [];
    $('install-steps').innerHTML = steps.map((t) => `<li>${t}</li>`).join('');
    showLayer($('install-sheet'), true);
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // ブラウザ任せのミニバーを出さず、タイトルのボタンから案内する
    deferredInstall = e;
    paintInstall();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; paintInstall(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => console.error('sw failed', e));
    });
}

// --- 初期化 -------------------------------------------------

function bind(id, fn, type = 'click') {
    const node = $(id);
    if (node) node.addEventListener(type, fn);
}

bind('btn-login', login);
bind('btn-login-sync', login);
bind('btn-guest', continueAsGuest);
bind('btn-begin', beginFromTitle);
bind('btn-signout', signOut);
bind('btn-leaderboard', openLeaderboard);
bind('btn-rank-more', openLeaderboard);
bind('btn-lb-close', () => showLayer(el.leaderboard, false));
bind('btn-retry', retry);
bind('btn-peek', peek);
bind('btn-peek-back', backFromPeek);
bind('btn-resume', resume);
bind('btn-install', install);
bind('btn-install-close', () => showLayer($('install-sheet'), false));
$('install-sheet').addEventListener('click', (e) => { if (e.target.id === 'install-sheet') showLayer($('install-sheet'), false); });
bind('btn-pause', pause);
bind('btn-quit', quitToTitle);
bind('btn-pause-settings', () => showLayer(el.settings, true));
bind('btn-settings', () => showLayer(el.settings, true));
bind('btn-settings-close', () => showLayer(el.settings, false));
$('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') showLayer(el.settings, false); });
el.stage.addEventListener('animationend', (e) => {
    if (e.animationName === 'levelUp') el.stage.classList.remove('levelup');
});

$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') beginFromTitle(); });

$('seg-surround').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) applySurround(b.dataset.surround);
});
$('seg-sound').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) applySound(b.dataset.sound === 'on');
});

// 画面を離れている間は計測を止める（復帰は明示的なタップで）
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if ($('install-sheet').classList.contains('on')) showLayer($('install-sheet'), false);
        else if (el.settings.classList.contains('on')) showLayer(el.settings, false);
        else if (el.leaderboard.classList.contains('on')) showLayer(el.leaderboard, false);
        else if (state.paused && e.key === 'Escape') resume();
        else if (state.running) pause();
    }
});

applySurround(state.surround);
applySound(state.sound);
paintInstall();
buildIris();
buildSteps();
setMode('title');
paintScore();
paintBest();
paintClock();
paintAuthState();
showLayer(el.title, true);
