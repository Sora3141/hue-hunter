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

// --- Authentication & Cloud Sync ---

async function login() {
    const provider = new window.fb.GoogleAuthProvider();
    try {
        const result = await window.fb.signInWithPopup(window.fb.auth, provider);
        state.user = result.user;
        state.isGuest = false;

        // ログイン時にクラウドの記録と同期
        await syncCloudRecord();
        
        showSetupUI(`Hello, ${state.user.displayName}`);
        
        // もしリザルト画面でログインした場合、即座にランキング更新
        if (state.isGameOver && state.score >= state.bestScore && state.score > 0) {
            saveWorldRecord();
            ui.loginNotice.style.display = 'none';
        }
    } catch (e) {
        console.error("Login failed", e);
    }
}

async function syncCloudRecord() {
    if (!state.user) return;
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        const docSnap = await window.fb.getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const cloudBest = data.score;
            const cloudName = data.name;

            // クラウドの方が記録が高ければローカルを上書き
            if (cloudBest > state.bestScore) {
                state.bestScore = cloudBest;
                localStorage.setItem(STORAGE_KEY, state.bestScore);
            }
            // 名前も同期
            if (cloudName) {
                localStorage.setItem(NAME_KEY, cloudName);
            }
        }
    } catch (e) {
        console.error("Sync error:", e);
    }
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

// --- Game Core ---

function startGame() {
    const nameInput = document.getElementById('display-name').value.trim();
    if (!nameInput) {
        alert("名前を入力してください");
        return;
    }
    localStorage.setItem(NAME_KEY, nameInput);
    
    ui.startScreen.style.opacity = '0';
    setTimeout(() => {
        ui.startScreen.style.display = 'none';
        renderGame();
    }, 500);
}

function renderGame() {
    // 盤面確認中以外でゲームオーバーなら描画しない
    if (state.isGameOver && !state.isPeeking) return;
    ui.board.innerHTML = '';
    
    const h = Math.floor(Math.random() * 360);
    const s = 80; 
    const l = 50; 

    // --- マクアダム楕円理論に基づく知覚的な難易度補正 ---
    let multiplier = 1.0;
    if (h >= 80 && h <= 165) {
        multiplier = 1.8; // 緑エリア：最も鈍感なため大きく補正
    } else if (h >= 166 && h <= 210) {
        multiplier = 1.3; // シアンエリア
    } else if (h >= 211 && h <= 280) {
        multiplier = 1.2; // 青・紫エリア
    } else {
        multiplier = 1.0; // 赤・黄エリア（基準）
    }

    // 補正倍率を適用した難易度(d)
    const d = state.currentDiff * multiplier; 
    const sign = Math.random() < 0.5 ? 1 : -1;
    const targetH = (h + (d * sign) + 360) % 360;

    const baseColor = `hsl(${h}, ${s}%, ${l}%)`;
    const targetColor = `hsl(${targetH}, ${s}%, ${l}%)`;
    const correctIndex = Math.floor(Math.random() * 25);

    for (let i = 0; i < 25; i++) {
        const block = document.createElement('div');
        block.className = 'block';
        
        // だららっ演出（左上から右下へ）
        const row = Math.floor(i / 5);
        const col = i % 5;
        block.style.animationDelay = `${(row + col) * 0.04}s`;
        
        block.style.backgroundColor = (i === correctIndex) ? targetColor : baseColor;
        if (i === correctIndex) block.id = "target";
        
        // クリックイベント
        block.onclick = () => {
            // ★重要：盤面確認モード(GameOver状態)ではクリックを無効化
            if (state.isGameOver) return; 
            (i === correctIndex) ? handleCorrect() : handleIncorrect();
        };

        // 盤面確認時の正解表示
        if (state.isGameOver && i === correctIndex) {
            block.classList.add('correct-answer');
        }
        ui.board.appendChild(block);
    }
}

function handleCorrect() {
    state.score++;
    ui.score.innerText = state.score;
    // 難易度曲線
    state.currentDiff = Math.max(1.8, 15 * Math.pow(0.978, state.score));
    renderGame();
}

function handleIncorrect() {
    state.isGameOver = true;
    const isNewBest = state.score > state.bestScore;
    
    // 不正解のブロックを薄くする
    document.querySelectorAll('.block').forEach(b => b.classList.add('fade-out'));
    // 正解のブロックだけ強調
    const target = document.getElementById('target');
    target.classList.remove('fade-out');
    target.classList.add('correct-answer');

    // ログイン済みならクラウドに記録
    if (!state.isGuest && state.user && isNewBest) {
        saveWorldRecord();
    }

    setTimeout(() => showResult(isNewBest), 800);
}

// --- Online Ranking ---

async function saveWorldRecord() {
    if (!state.user) return;
    const playerName = localStorage.getItem(NAME_KEY) || "Unknown";
    try {
        const docRef = window.fb.doc(window.fb.db, "rankings", state.user.uid);
        await window.fb.setDoc(docRef, {
            name: playerName,
            score: state.score,
            timestamp: window.fb.serverTimestamp()
        });
    } catch (e) {
        console.error("Save error", e);
    }
}

async function loadWorldRanking() {
    const listEl = document.getElementById('ranking-list');
    try {
        const q = window.fb.query(
            window.fb.collection(window.fb.db, "rankings"),
            window.fb.orderBy("score", "desc")
        );
        const snap = await window.fb.getDocs(q);
        
        let html = "";
        let rank = 1;
        let myRankData = null;
        const topLimit = 5;

        snap.forEach(doc => {
            const data = doc.data();
            const isMe = state.user && doc.id === state.user.uid;

            // TOP 5 表示
            if (rank <= topLimit) {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px; ${isMe ? 'color:var(--accent-color); font-weight:bold;' : ''}">
                            <span>${rank}. ${data.name}${isMe ? ' (You)' : ''}</span>
                            <span>${data.score}</span>
                         </div>`;
            }
            // 自分のランクを保存
            if (isMe) {
                myRankData = { rank, score: data.score, name: data.name };
            }
            rank++;
        });

        // 自分がランク外(6位以下)なら下に表示
        if (myRankData && myRankData.rank > topLimit) {
            html += `<div style="border-top: 1px dashed rgba(255,255,255,0.3); margin: 8px 0; padding-top: 8px;"></div>
                     <div style="display:flex; justify-content:space-between; color:var(--accent-color); font-weight:bold;">
                        <span>${myRankData.rank}. ${myRankData.name} (You)</span>
                        <span>${myRankData.score}</span>
                     </div>`;
        }

        listEl.innerHTML = html || "No records yet";
    } catch (e) {
        listEl.innerHTML = "Error loading ranking";
    }
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
    // 100点以上で金文字クラス付与
    if (state.score >= 100) ui.resRank.classList.add('gold-text');
    else ui.resRank.classList.remove('gold-text');

    ui.resScore.innerText = state.score;
    ui.resBest.innerText = state.bestScore;
    ui.resMsg.innerText = info.msg;
    
    ui.overlay.style.display = 'flex';
    setTimeout(() => ui.overlay.classList.add('visible'), 10);
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
    for (let i = 0; i < 40; i++) {
        const p = document.createElement('div');
        document.body.appendChild(p);
        const x = window.innerWidth / 2, y = window.innerHeight / 2;
        p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;background:hsl(${Math.random()*360},100%,60%);border-radius:50%;z-index:1000;pointer-events:none;`;
        const angle = Math.random()*Math.PI*2, v = Math.random()*12+4;
        let vx = Math.cos(angle)*v, vy = Math.sin(angle)*v, op = 1;
        const anim = () => {
            vx *= 0.97; vy += 0.25;
            p.style.left = (parseFloat(p.style.left)+vx)+'px';
            p.style.top = (parseFloat(p.style.top)+vy)+'px';
            op -= 0.015; p.style.opacity = op;
            if (op > 0) requestAnimationFrame(anim); else p.remove();
        };
        requestAnimationFrame(anim);
    }
}

function peekBoard() {
    state.isPeeking = true;
    // フェードアウト状態を解除して盤面を見やすくする
    document.querySelectorAll('.block').forEach(b => b.classList.remove('fade-out'));
    
    ui.overlay.classList.remove('visible');
    setTimeout(() => { 
        ui.overlay.style.display = 'none'; 
        ui.backBtn.classList.add('visible'); 
    }, 300);
}

function resetGame() {
    state.score = 0; 
    state.currentDiff = 15; 
    state.isGameOver = false; 
    state.isPeeking = false;
    
    ui.score.innerText = 0; 
    ui.overlay.classList.remove('visible');
    
    setTimeout(() => { 
        ui.overlay.style.display = 'none'; 
        renderGame(); 
    }, 300);
}