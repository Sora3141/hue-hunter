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

const ui = {
    score: document.getElementById('score-display'),
    board: document.getElementById('game-board'),
    overlay: document.getElementById('result-overlay'),
    resRank: document.getElementById('res-rank'),
    resMsg: document.getElementById('res-msg'),
    resScore: document.getElementById('res-score'),
    resBest: document.getElementById('res-best'),
    startScreen: document.getElementById('start-screen'),
    backBtn: document.getElementById('back-to-result'),
    loginNotice: document.getElementById('guest-login-notice')
};

async function login() {
    const provider = new window.fb.GoogleAuthProvider();
    try {
        const result = await window.fb.signInWithPopup(window.fb.auth, provider);
        state.user = result.user;
        state.isGuest = false;
        await syncCloudRecord();
        showSetupUI(`Hello, ${state.user.displayName}`);
    } catch (e) { console.error(e); }
}

async function syncCloudRecord() {
    if (!state.user) return;
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        const docSnap = await window.fb.getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.score > state.bestScore) {
                state.bestScore = data.score;
                localStorage.setItem(STORAGE_KEY, state.bestScore);
            }
            if (data.name) localStorage.setItem(NAME_KEY, data.name);
        }
    } catch (e) { console.error(e); }
}

function continueAsGuest() {
    state.isGuest = true;
    state.user = null;
    showSetupUI("Guest Mode");
}

function showSetupUI(msg) {
    document.getElementById('login-options').style.display = 'none';
    document.getElementById('setup-ui').style.display = 'flex';
    document.getElementById('welcome-msg').innerText = msg;
    const savedName = localStorage.getItem(NAME_KEY);
    if(savedName) document.getElementById('display-name').value = savedName;
}

function startGame() {
    const nameInput = document.getElementById('display-name').value.trim();
    if (!nameInput) { alert("名前を入力してください"); return; }
    localStorage.setItem(NAME_KEY, nameInput);
    ui.startScreen.style.opacity = '0';
    setTimeout(() => { ui.startScreen.style.display = 'none'; renderGame(); }, 500);
}

function renderGame() {
    if (state.isGameOver && !state.isPeeking) return;
    ui.board.innerHTML = '';
    const h = Math.floor(Math.random() * 360), s = 80, l = 50;
    const d = state.currentDiff, sign = Math.random() < 0.5 ? 1 : -1;
    const targetH = (h + (d * sign) + 360) % 360;
    const correctIndex = Math.floor(Math.random() * 25);
    
    for (let i = 0; i < 25; i++) {
        const block = document.createElement('div');
        block.className = 'block';
        
        // だららっ演出（左上から右下へ）
        const row = Math.floor(i / 5);
        const col = i % 5;
        block.style.animationDelay = `${(row + col) * 0.04}s`;
        
        block.style.backgroundColor = (i === correctIndex) ? `hsl(${targetH}, ${s}%, ${l}%)` : `hsl(${h}, ${s}%, ${l}%)`;
        if (i === correctIndex) block.id = "target";
        
        if (!state.isGameOver) {
            block.onclick = () => (i === correctIndex) ? handleCorrect() : handleIncorrect();
        } else if (i === correctIndex) {
            block.classList.add('correct-answer');
        }
        ui.board.appendChild(block);
    }
}

function handleCorrect() {
    state.score++;
    ui.score.innerText = state.score;
    state.currentDiff = Math.max(1.8, 15 * Math.pow(0.978, state.score));
    renderGame();
}

function handleIncorrect() {
    state.isGameOver = true;
    const isNewBest = state.score > state.bestScore;
    document.querySelectorAll('.block').forEach(b => b.classList.add('fade-out'));
    document.getElementById('target').classList.add('correct-answer');
    if (!state.isGuest && state.user && isNewBest) saveWorldRecord();
    setTimeout(() => showResult(isNewBest), 800);
}

async function saveWorldRecord() {
    if (!state.user) return;
    try {
        await window.fb.setDoc(window.fb.doc(window.fb.db, "rankings", state.user.uid), {
            name: localStorage.getItem(NAME_KEY),
            score: state.score,
            timestamp: window.fb.serverTimestamp()
        });
    } catch (e) { console.error(e); }
}

async function loadWorldRanking() {
    const listEl = document.getElementById('ranking-list');
    try {
        const q = window.fb.query(window.fb.collection(window.fb.db, "rankings"), window.fb.orderBy("score", "desc"));
        const snap = await window.fb.getDocs(q);
        let html = "", rank = 1, myRankData = null;
        snap.forEach(doc => {
            const data = doc.data(), isMe = state.user && doc.id === state.user.uid;
            if (rank <= 5) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px; ${isMe ? 'color:var(--accent-color); font-weight:bold;' : ''}">
                            <span>${rank}. ${data.name}${isMe ? ' (You)' : ''}</span><span>${data.score}</span>
                         </div>`;
            }
            if (isMe) myRankData = { rank, score: data.score, name: data.name };
            rank++;
        });
        if (myRankData && myRankData.rank > 5) {
            html += `<div style="border-top:1px dashed rgba(255,255,255,0.3); margin:8px 0; padding-top:8px;"></div>
                     <div style="display:flex; justify-content:space-between; color:var(--accent-color); font-weight:bold;">
                        <span>${myRankData.rank}. ${myRankData.name} (You)</span><span>${myRankData.score}</span>
                     </div>`;
        }
        listEl.innerHTML = html || "No records yet";
    } catch (e) { listEl.innerHTML = "Error loading ranking"; }
}

function showResult(isNewBest) {
    state.isPeeking = false;
    ui.backBtn.classList.remove('visible');
    if (isNewBest) {
        state.bestScore = state.score;
        localStorage.setItem(STORAGE_KEY, state.bestScore);
        document.getElementById('new-record-label').style.display = 'block';
        createFirework();
    } else {
        document.getElementById('new-record-label').style.display = 'none';
    }
    ui.loginNotice.style.display = (!state.user) ? 'block' : 'none';
    loadWorldRanking();
    
    const info = getRankInfo(state.score);
    ui.resRank.innerText = info.rank;
    if (state.score >= 100) ui.resRank.classList.add('gold-text');
    else ui.resRank.classList.remove('gold-text');
    
    ui.resScore.innerText = state.score;
    ui.resBest.innerText = state.bestScore;
    ui.resMsg.innerText = info.msg;

    ui.overlay.style.display = 'flex';
    setTimeout(() => { ui.overlay.classList.add('visible'); }, 10);
}

function getRankInfo(score) {
    if (score >= 100) return { rank: "👁️‍🗨️ 神の目", msg: "真理の到達者。1.8度の深淵を見通す、神の領域。" };
    if (score >= 90)  return { rank: "🌌 色彩の特異点", msg: "デバイスの限界を超え、色の法則を書き換えた。" };
    if (score >= 75)  return { rank: "✨ 聖域の色彩", msg: "人間卒業。色の粒子が放つ微細な鼓動を捉えている。" };
    if (score >= 55)  return { rank: "🎨 絶対色感", msg: "1pxの濁りも逃さないプロの瞳。" };
    if (score >= 35)  return { rank: "🦅 蒼穹の鷹", msg: "鋭い。わずかな色彩の揺らぎを見逃さない観察眼。" };
    if (score >= 20)  return { rank: "🍷 色彩ソムリエ", msg: "違いの分かる瞳。色の個性を楽しみ始めた選ばれし者。" };
    if (score >= 10)  return { rank: "🖌️ 見習い画家", msg: "才能の片鱗。迷宮を抜ける鍵を既に手にしている。" };
    return { rank: "🚶 一般市民", msg: "まだ見ぬ色彩が君を待っている。" };
}

function createFirework() {
    for (let i = 0; i < 40; i++) {
        const p = document.createElement('div');
        document.body.appendChild(p);
        const x = window.innerWidth / 2, y = window.innerHeight / 2;
        p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;background:hsl(${Math.random()*360},100%,60%);border-radius:50%;z-index:1000;pointer-events:none;`;
        const angle = Math.random()*Math.PI*2, v = Math.random()*12+4;
        let vx = Math.cos(angle)*v, vy = Math.sin(angle)*v, op = 1;
        const anim = () => {
            vx *= 0.97; vy += 0.25;
            p.style.left = (parseFloat(p.style.left)+vx)+'px'; p.style.top = (parseFloat(p.style.top)+vy)+'px';
            op -= 0.015; p.style.opacity = op;
            if (op > 0) requestAnimationFrame(anim); else p.remove();
        };
        requestAnimationFrame(anim);
    }
}

function peekBoard() {
    state.isPeeking = true;
    document.querySelectorAll('.block').forEach(b => b.classList.remove('fade-out'));
    ui.overlay.classList.remove('visible');
    setTimeout(() => { 
        ui.overlay.style.display = 'none'; 
        ui.backBtn.classList.add('visible'); 
    }, 300);
}

function resetGame() {
    state.score = 0; state.currentDiff = 15; state.isGameOver = false; state.isPeeking = false;
    ui.score.innerText = 0; ui.overlay.classList.remove('visible');
    setTimeout(() => { ui.overlay.style.display = 'none'; renderGame(); }, 300);
}