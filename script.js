// キーを v6 に変更して記録をリセット
const STORAGE_KEY = 'hueHunter_v6_best';
const NAME_KEY = 'hueHunter_v6_name';

const state = {
    score: 0,
    bestScore: parseInt(localStorage.getItem(STORAGE_KEY)) || 0,
    currentDiff: 15,
    isGameOver: false,
    isPeeking: false,
    user: null,
    isGuest: false
};

// --- Auth (リダイレクト・404回避ロジック) ---

async function login() {
    if (!window.fb) return;
    const provider = new window.fb.GoogleAuthProvider();
    // アカウント選択画面を強制的に出す設定（確実にリダイレクトを走らせる）
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        const loginBtn = document.getElementById('btn-google-login');
        if (loginBtn) {
            loginBtn.innerText = "ログイン中...";
            loginBtn.disabled = true;
        }
        // GitHub Pagesではポップアップよりリダイレクトが安定します
        await window.fb.signInWithRedirect(window.fb.auth, provider);
    } catch (e) { 
        console.error("Login initiation failed", e);
        resetLoginBtn();
    }
}

function resetLoginBtn() {
    const loginBtn = document.getElementById('btn-google-login');
    if (loginBtn) {
        loginBtn.innerText = "Googleでログイン";
        loginBtn.disabled = false;
    }
}

function handleLoginSuccess(user) {
    if (state.user) return; // 重複処理防止
    state.user = user;
    state.isGuest = false;
    
    // UIを名前入力画面に切り替え
    const loginOptions = document.getElementById('login-options');
    const setupUi = document.getElementById('setup-ui');
    if (loginOptions) loginOptions.style.display = 'none';
    if (setupUi) setupUi.style.display = 'flex';
    
    const welcomeMsg = document.getElementById('welcome-msg');
    if (welcomeMsg) welcomeMsg.innerText = `Hello, ${user.displayName}`;
    
    const savedName = localStorage.getItem(NAME_KEY);
    const nameInput = document.getElementById('display-name');
    if (savedName && nameInput) nameInput.value = savedName;

    // クラウドからベストスコアを同期
    syncCloudRecord();
}

// --- Game Logic ---

function startGame() {
    const nameInput = document.getElementById('display-name');
    const nameValue = nameInput ? nameInput.value.trim() : "Player";
    if (!nameValue) { alert("名前を入力してください"); return; }
    localStorage.setItem(NAME_KEY, nameValue);
    document.getElementById('start-screen').style.display = 'none';
    renderGame();
}

function renderGame() {
    if (state.isGameOver && !state.isPeeking) return;
    const board = document.getElementById('game-board');
    if (!board) return;
    board.innerHTML = '';
    const h = Math.floor(Math.random() * 360), s = 80, l = 50; 
    let m = (h >= 80 && h <= 165) ? 1.8 : (h >= 166 && h <= 210) ? 1.3 : (h >= 211 && h <= 280) ? 1.2 : 1.0;
    const d = state.currentDiff * m;
    const correctIndex = Math.floor(Math.random() * 25);

    for (let i = 0; i < 25; i++) {
        const block = document.createElement('div');
        block.className = 'block';
        block.style.backgroundColor = (i === correctIndex) ? `hsl(${(h+(d*(Math.random()<0.5?1:-1))+360)%360},${s}%,${l}%)` : `hsl(${h},${s}%,${l}%)`;
        if (i === correctIndex) block.id = "target";
        block.onclick = () => { if (!state.isGameOver) (i === correctIndex) ? handleCorrect() : handleIncorrect(); };
        board.appendChild(block);
    }
}

function handleCorrect() {
    state.score++;
    document.getElementById('score-display').innerText = state.score;
    state.currentDiff = Math.max(1.8, 15 * Math.pow(0.978, state.score));
    renderGame();
}

function handleIncorrect() {
    if (state.isGameOver) return;
    state.isGameOver = true;
    const localBest = parseInt(localStorage.getItem(STORAGE_KEY)) || 0;
    if (state.score > localBest) {
        state.bestScore = state.score;
        localStorage.setItem(STORAGE_KEY, state.score);
    } else { state.bestScore = localBest; }

    document.querySelectorAll('.block').forEach(b => b.classList.add('fade-out'));
    const target = document.getElementById('target');
    if (target) { target.classList.remove('fade-out'); target.classList.add('correct-answer'); }
    if (!state.isGuest && state.user) saveWorldRecord();
    setTimeout(() => displayResultUI(), 800);
}

// --- Result & Ranking ---

function displayResultUI() {
    state.isPeeking = false;
    const overlay = document.getElementById('result-overlay');
    const finalBest = parseInt(localStorage.getItem(STORAGE_KEY)) || state.score;
    document.getElementById('res-score').innerText = state.score;
    document.getElementById('res-best').innerText = finalBest;

    const newLabel = document.getElementById('new-record-label');
    if (newLabel) {
        newLabel.style.display = (state.score >= finalBest && state.score > 0) ? 'block' : 'none';
        if (state.score >= finalBest && state.score > 0) createFirework();
    }
    
    document.getElementById('guest-login-notice').style.display = (!state.user) ? 'block' : 'none';
    loadWorldRanking();
    
    const info = getRankInfo(state.score);
    document.getElementById('res-rank').innerText = info.rank;
    document.getElementById('res-msg').innerText = info.msg;
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('visible'), 50);
}

async function saveWorldRecord() {
    if (!state.user || !window.fb) return;
    const playerName = localStorage.getItem(NAME_KEY) || "Unknown";
    const bestToSave = parseInt(localStorage.getItem(STORAGE_KEY)) || state.score;
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        await window.fb.setDoc(docRef, { name: playerName, score: bestToSave, timestamp: window.fb.serverTimestamp() }, { merge: true });
    } catch (e) { console.error("Save error", e); }
}

async function loadWorldRanking() {
    if (!window.fb || !window.fb.db) return;
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
                     <div style="display:flex; justify-content:space-between; color:var(--accent-color); font-weight:bold;"><span>${myRankData.rank}. ${myRankData.name} (You)</span><span>${myRankData.score}</span></div>`;
        }
        document.getElementById('ranking-list').innerHTML = html || "No records";
        const startRanking = document.getElementById('start-ranking-list');
        if (startRanking) startRanking.innerHTML = html || "No records";
    } catch (e) { console.error("Load error:", e); }
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

// --- Utils ---

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
            p.style.left = (parseFloat(p.style.left)+vx)+'px'; p.style.top = (parseFloat(p.style.top)+vy)+'px';
            op -= 0.02; p.style.opacity = op;
            if (op > 0) requestAnimationFrame(anim); else p.remove();
        };
        requestAnimationFrame(anim);
    }
}

// --- Init & Controllers ---

function continueAsGuest() {
    state.isGuest = true;
    const loginOptions = document.getElementById('login-options');
    const setupUi = document.getElementById('setup-ui');
    if (loginOptions) loginOptions.style.display = 'none';
    if (setupUi) setupUi.style.display = 'flex';
    document.getElementById('welcome-msg').innerText = "Guest Mode";
}

function toggleStartRanking() {
    const container = document.getElementById('start-ranking-container');
    const btn = document.getElementById('btn-show-ranking');
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
    document.getElementById('score-display').innerText = "0";
    document.getElementById('result-overlay').classList.remove('visible');
    setTimeout(() => { document.getElementById('result-overlay').style.display = 'none'; renderGame(); }, 300);
}

function peekBoard() {
    state.isPeeking = true;
    document.querySelectorAll('.block').forEach(b => b.classList.remove('fade-out'));
    document.getElementById('result-overlay').classList.remove('visible');
    setTimeout(() => { document.getElementById('result-overlay').style.display = 'none'; document.getElementById('back-to-result').classList.add('visible'); }, 300);
}

window.login = login;
window.continueAsGuest = continueAsGuest;
window.startGame = startGame;
window.toggleStartRanking = toggleStartRanking;
window.resetGame = resetGame;
window.peekBoard = peekBoard;
window.showResult = () => { state.isPeeking = false; document.getElementById('back-to-result').classList.remove('visible'); displayResultUI(); };

function initRanking() { 
    if (window.fb && window.fb.auth) { 
        const loginBtn = document.getElementById('btn-google-login');
        if (loginBtn) loginBtn.innerText = "認証情報を確認中...";

        // 画像の404エラーを飛び越えて、ブラウザ内の認証変化を直接キャッチする
        window.fb.onAuthStateChanged(window.fb.auth, (user) => {
            if (user) {
                handleLoginSuccess(user);
            } else {
                // 戻ってきた直後は検証に時間がかかるため、2秒待ってダメならボタンを戻す
                setTimeout(() => { if (!window.fb.auth.currentUser) resetLoginBtn(); }, 2000);
            }
        });

        // 明示的にリダイレクト結果を拾う（404エラーが出てもバックグラウンドで処理される場合がある）
        window.fb.getRedirectResult(window.fb.auth).then((result) => {
            if (result && result.user) handleLoginSuccess(result.user);
        }).catch((e) => console.log("Catching potential redirect artifact:", e.message));

        loadWorldRanking(); 
    } else { setTimeout(initRanking, 500); } 
}
initRanking();