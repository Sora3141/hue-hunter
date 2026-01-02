const STORAGE_KEY = 'hueHunter_v5_best';
const NAME_KEY = 'hueHunter_v5_name';

const state = {
    score: 0,
    bestScore: parseInt(localStorage.getItem(STORAGE_KEY)) || 0,
    currentDiff: 15,
    isGameOver: false,
    isPeeking: false,
    user: null,
    isGuest: false
};

// --- Auth ---

async function login() {
    if (!window.fb) return;
    const provider = new window.fb.GoogleAuthProvider();
    try {
        const result = await window.fb.signInWithPopup(window.fb.auth, provider);
        state.user = result.user;
        state.isGuest = false;
        await syncCloudRecord();
        if (state.bestScore > 0) await saveWorldRecord();
        showSetupUI(`Hello, ${state.user.displayName}`);
    } catch (e) { console.error("Login failed", e); }
}

async function syncCloudRecord() {
    if (!state.user || !window.fb) return;
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        const docSnap = await window.fb.getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.score > state.bestScore) {
                state.bestScore = data.score;
                localStorage.setItem(STORAGE_KEY, state.bestScore);
            }
        }
    } catch (e) { console.error("Sync error:", e); }
}

function continueAsGuest() {
    state.isGuest = true;
    state.user = null;
    showSetupUI("Guest Mode");
}

function showSetupUI(msg) {
    const loginOpts = document.getElementById('login-options');
    const setupUi = document.getElementById('setup-ui');
    const welcomeMsg = document.getElementById('welcome-msg');
    if (loginOpts) loginOpts.style.display = 'none';
    if (setupUi) setupUi.style.display = 'flex';
    if (welcomeMsg) welcomeMsg.innerText = msg;
    const savedName = localStorage.getItem(NAME_KEY);
    const nameInput = document.getElementById('display-name');
    if(savedName && nameInput) nameInput.value = savedName;
}

// --- Game Logic ---

function startGame() {
    const nameInput = document.getElementById('display-name');
    const nameValue = nameInput ? nameInput.value.trim() : "Player";
    if (!nameValue) { alert("名前を入力してください"); return; }
    localStorage.setItem(NAME_KEY, nameValue);
    const startScreen = document.getElementById('start-screen');
    if (startScreen) {
        startScreen.style.opacity = '0';
        setTimeout(() => {
            startScreen.style.display = 'none';
            renderGame();
        }, 500);
    }
}

function renderGame() {
    if (state.isGameOver && !state.isPeeking) return;
    const board = document.getElementById('game-board');
    if (!board) return;
    board.innerHTML = '';
    const h = Math.floor(Math.random() * 360);
    const s = 80; const l = 50; 
    let m = (h >= 80 && h <= 165) ? 1.8 : (h >= 166 && h <= 210) ? 1.3 : (h >= 211 && h <= 280) ? 1.2 : 1.0;
    const d = state.currentDiff * m;
    const sign = Math.random() < 0.5 ? 1 : -1;
    const targetH = (h + (d * sign) + 360) % 360;
    const correctIndex = Math.floor(Math.random() * 25);

    for (let i = 0; i < 25; i++) {
        const block = document.createElement('div');
        block.className = 'block';
        const row = Math.floor(i / 5), col = i % 5;
        block.style.animationDelay = `${(row + col) * 0.04}s`;
        block.style.backgroundColor = (i === correctIndex) ? `hsl(${targetH},${s}%,${l}%)` : `hsl(${h},${s}%,${l}%)`;
        if (i === correctIndex) block.id = "target";
        block.onclick = () => { if (!state.isGameOver) (i === correctIndex) ? handleCorrect() : handleIncorrect(); };
        board.appendChild(block);
    }
}

function handleCorrect() {
    state.score++;
    const scoreDisplay = document.getElementById('score-display');
    if (scoreDisplay) scoreDisplay.innerText = state.score;
    state.currentDiff = Math.max(1.8, 15 * Math.pow(0.978, state.score));
    renderGame();
}

function handleIncorrect() {
    if (state.isGameOver) return;
    state.isGameOver = true;
    const isNewBest = state.score > state.bestScore;
    if (isNewBest) {
        state.bestScore = state.score;
        localStorage.setItem(STORAGE_KEY, state.bestScore);
    }
    document.querySelectorAll('.block').forEach(b => b.classList.add('fade-out'));
    const target = document.getElementById('target');
    if (target) {
        target.classList.remove('fade-out');
        target.classList.add('correct-answer');
    }
    if (!state.isGuest && state.user) saveWorldRecord();
    setTimeout(() => displayResultUI(isNewBest), 800);
}

// --- Result & UI ---

// 名称変更: displayResultUI (内部処理用)
function displayResultUI(isNewBest) {
    state.isPeeking = false;
    const overlay = document.getElementById('result-overlay');
    if (!overlay) return;

    const resScoreEl = document.getElementById('res-score');
    const resBestEl = document.getElementById('res-best');
    const newRecordLabel = document.getElementById('new-record-label');
    const loginNotice = document.getElementById('guest-login-notice');

    if (resScoreEl) resScoreEl.innerText = state.score;
    if (resBestEl) resBestEl.innerText = state.bestScore;
    if (newRecordLabel) {
        newRecordLabel.style.display = isNewBest ? 'block' : 'none';
        if (isNewBest) createFirework();
    }
    if (loginNotice) loginNotice.style.display = (!state.user) ? 'block' : 'none';
    
    loadWorldRanking();
    
    const info = getRankInfo(state.score);
    const rankEl = document.getElementById('res-rank');
    const msgEl = document.getElementById('res-msg');
    if (rankEl) {
        rankEl.innerText = info.rank;
        if (state.score >= 100) rankEl.classList.add('gold-text');
        else rankEl.classList.remove('gold-text');
    }
    if (msgEl) msgEl.innerText = info.msg;
    
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('visible'), 50);
}

async function saveWorldRecord() {
    if (!state.user || !window.fb) return;
    const playerName = localStorage.getItem(NAME_KEY) || "Unknown";
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        await window.fb.setDoc(docRef, { name: playerName, score: state.bestScore, timestamp: window.fb.serverTimestamp() }, { merge: true });
    } catch (e) { console.error("Save error", e); }
}

async function loadWorldRanking() {
    if (!window.fb || !window.fb.db) return;
    const listEl = document.getElementById('ranking-list');
    const startListEl = document.getElementById('start-ranking-list');
    try {
        const q = window.fb.query(window.fb.collection(window.fb.db, "rankings"), window.fb.orderBy("score", "desc"), window.fb.limit(10));
        const snap = await window.fb.getDocs(q);
        let html = ""; let rank = 1; let myRankData = null;
        snap.forEach(doc => {
            const data = doc.data();
            const isMe = state.user && doc.id === state.user.uid;
            if (rank <= 5) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px; ${isMe ? 'color:var(--accent-color); font-weight:bold;' : ''}">
                            <span>${rank}. ${data.name}${isMe ? ' (You)' : ''}</span>
                            <span>${data.score}</span>
                         </div>`;
            }
            if (isMe) myRankData = { rank, score: data.score, name: data.name };
            rank++;
        });
        if (myRankData && myRankData.rank > 5) {
            html += `<div style="border-top: 1px dashed rgba(255,255,255,0.3); margin: 8px 0; padding-top: 8px;"></div>
                     <div style="display:flex; justify-content:space-between; color:var(--accent-color); font-weight:bold;">
                        <span>${myRankData.rank}. ${myRankData.name} (You)</span>
                        <span>${myRankData.score}</span>
                     </div>`;
        }
        if (listEl) listEl.innerHTML = html || "No records";
        if (startListEl) startListEl.innerHTML = html || "No records";
    } catch (e) { console.error("Load error:", e); }
}

// --- UI Controls ---

function toggleStartRanking() {
    const container = document.getElementById('start-ranking-container');
    const btn = document.getElementById('btn-show-ranking');
    if (!container || !btn) return;
    if (container.style.display === 'none') {
        container.style.display = 'block';
        btn.innerText = '✖ ランキングを閉じる';
        loadWorldRanking(); 
    } else {
        container.style.display = 'none';
        btn.innerText = '🏆 ランキングを表示';
    }
}

function resetGame() {
    state.score = 0; state.currentDiff = 15; state.isGameOver = false; state.isPeeking = false;
    const scoreDisp = document.getElementById('score-display');
    const overlay = document.getElementById('result-overlay');
    if (scoreDisp) scoreDisp.innerText = "0";
    if (overlay) overlay.classList.remove('visible');
    setTimeout(() => { if (overlay) overlay.style.display = 'none'; renderGame(); }, 300);
}

function peekBoard() {
    state.isPeeking = true;
    document.querySelectorAll('.block').forEach(b => b.classList.remove('fade-out'));
    const overlay = document.getElementById('result-overlay');
    const backBtn = document.getElementById('back-to-result');
    if (overlay) overlay.classList.remove('visible');
    setTimeout(() => { 
        if (overlay) overlay.style.display = 'none'; 
        if (backBtn) backBtn.classList.add('visible'); 
    }, 300);
}

// ボタン用の名称: showResultFromPeek
function showResultFromPeek() {
    state.isPeeking = false;
    const backBtn = document.getElementById('back-to-result');
    if (backBtn) backBtn.classList.remove('visible');
    displayResultUI(false); // 無限ループを回避するため displayResultUI を直接呼ぶ
}

// ランク情報を元の豪華な種類に復元
function getRankInfo(score) {
    if (score >= 100) return { rank: "👁️‍🗨️ 神の目", msg: "真理の到達者。色彩の深淵を見通す、神の領域。" };
    if (score >= 90)  return { rank: "🌌 色彩の特異点", msg: "デバイスの限界を超え、色の法則を書き換えた。" };
    if (score >= 75)  return { rank: "✨ 聖域の色彩", msg: "人間卒業。色の粒子が放つ微細な鼓動を捉えている。" };
    if (score >= 55)  return { rank: "🎨 絶対色感", msg: "一点の濁りも逃さないプロの瞳。" };
    if (score >= 35)  return { rank: "🦅 蒼穹の鷹", msg: "鋭い。わずかな色彩の揺らぎを見逃さない観察眼。" };
    if (score >= 20)  return { rank: "🍷 色彩ソムリエ", msg: "違いの分かる瞳。色の個性を楽しみ始めた選ばれし者。" };
    if (score >= 10)  return { rank: "🖌️ 見習い画家", msg: "才能の片鱗。迷宮を抜ける鍵を既に手にしている。" };
    return { rank: "🚶 一般市民", msg: "まだ見ぬ色彩が君を待っている。" };
}

function createFirework() {
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        document.body.appendChild(p);
        const x = window.innerWidth / 2, y = window.innerHeight / 2;
        p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;background:hsl(${Math.random()*360},100%,60%);border-radius:50%;z-index:3000;pointer-events:none;`;
        const angle = Math.random()*Math.PI*2, v = Math.random()*10+5;
        let vx = Math.cos(angle)*v, vy = Math.sin(angle)*v, op = 1;
        const anim = () => {
            vx *= 0.96; vy += 0.25;
            p.style.left = (parseFloat(p.style.left)+vx)+'px';
            p.style.top = (parseFloat(p.style.top)+vy)+'px';
            op -= 0.02; p.style.opacity = op;
            if (op > 0) requestAnimationFrame(anim); else p.remove();
        };
        requestAnimationFrame(anim);
    }
}

// Global Register
window.login = login;
window.continueAsGuest = continueAsGuest;
window.startGame = startGame;
window.toggleStartRanking = toggleStartRanking;
window.resetGame = resetGame;
window.peekBoard = peekBoard;
window.showResult = showResultFromPeek; // HTMLのonclick用

function initRanking() { if (window.fb && window.fb.db) { loadWorldRanking(); } else { setTimeout(initRanking, 500); } }
initRanking();