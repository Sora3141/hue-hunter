const state = {
    score: 0,
    bestScore: parseInt(localStorage.getItem('hueHunterBest')) || 0,
    currentDiff: 15,
    isGameOver: false,
    isPeeking: false
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
    backBtn: document.getElementById('back-to-result')
};

function startGame() {
    ui.startScreen.style.opacity = '0';
    setTimeout(() => {
        ui.startScreen.style.display = 'none';
        renderGame();
    }, 500);
}

function renderGame() {
    if (state.isGameOver && !state.isPeeking) return;
    ui.board.innerHTML = '';
    
    // RGBの差が出やすい範囲（S:75-85%, L:45-55%）で色を生成
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 10) + 75; 
    const l = Math.floor(Math.random() * 10) + 45; 

    const d = state.currentDiff; 
    const sign = Math.random() < 0.5 ? 1 : -1;
    const targetH = (h + (d * sign) + 360) % 360;

    const baseColor = `hsl(${h}, ${s}%, ${l}%)`;
    const targetColor = `hsl(${targetH}, ${s}%, ${l}%)`;
    const correctIndex = Math.floor(Math.random() * 25);

    for (let i = 0; i < 25; i++) {
        const block = document.createElement('div');
        block.className = 'block';
        
        // だらららっ演出（左上から右下へのディレイ）
        const row = Math.floor(i / 5);
        const col = i % 5;
        block.style.animationDelay = `${(row + col) * 0.05}s`;

        block.style.backgroundColor = (i === correctIndex) ? targetColor : baseColor;
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
    // 難易度曲線：90点までは指数関数的に難化、100点で1.8度（物理限界）に到達
    if (state.score < 90) {
        state.currentDiff = Math.max(2.0, 15 * Math.pow(0.978, state.score));
    } else {
        state.currentDiff = Math.max(1.8, state.currentDiff - 0.02);
    }
    renderGame();
}

function handleIncorrect() {
    state.isGameOver = true;
    const isNewBest = state.score > state.bestScore;
    
    document.querySelectorAll('.block').forEach(b => b.classList.add('fade-out'));
    const target = document.getElementById('target');
    target.classList.remove('fade-out');
    target.classList.add('correct-answer');

    setTimeout(() => showResult(isNewBest), 1000);
}

// Firebase：オンライン保存
async function loginAndSave() {
    if (!window.fb) {
        alert("Firebaseが初期化されていません。HTMLの設定を確認してください。");
        return;
    }
    const provider = new window.fb.GoogleAuthProvider();
    try {
        const result = await window.fb.signInWithPopup(window.fb.auth, provider);
        const user = result.user;
        
        // Firestoreにスコアを送信
        await window.fb.addDoc(window.fb.collection(window.fb.db, "rankings"), {
            name: user.displayName,
            score: state.score,
            timestamp: window.fb.serverTimestamp()
        });
        
        document.getElementById('online-save-container').style.display = 'none';
        loadWorldRanking();
        alert("世界ランキングに登録しました！");
    } catch (e) {
        console.error("Firebase Error:", e);
        alert("登録に失敗しました。コンソールを確認してください。");
    }
}

// Firebase：最新ランキング5件を取得
async function loadWorldRanking() {
    const listEl = document.getElementById('ranking-list');
    if (!window.fb) return;
    try {
        const q = window.fb.query(
            window.fb.collection(window.fb.db, "rankings"),
            window.fb.orderBy("score", "desc"),
            window.fb.limit(5)
        );
        const snap = await window.fb.getDocs(q);
        let html = "";
        let i = 1;
        snap.forEach(doc => {
            const data = doc.data();
            html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span>${i}. ${data.name}</span>
                        <span style="color:var(--accent-color);">${data.score}pts</span>
                     </div>`;
            i++;
        });
        listEl.innerHTML = html || "No records yet";
    } catch (e) {
        console.error("Rank Load Error:", e);
        listEl.innerHTML = "Error loading ranking";
    }
}

function showResult(isNewBest) {
    state.isPeeking = false;
    ui.backBtn.classList.remove('visible');
    const info = getRankInfo(state.currentDiff, state.score);

    if (isNewBest) {
        state.bestScore = state.score;
        localStorage.setItem('hueHunterBest', state.bestScore);
        document.getElementById('new-record-label').style.display = 'block';
        createFirework(); // 新記録なら紙吹雪
    } else {
        document.getElementById('new-record-label').style.display = 'none';
    }

    // ★ テスト用：1点以上なら登録ボタンを表示
    if (state.score >= 1) {
        document.getElementById('online-save-container').style.display = 'block';
    } else {
        document.getElementById('online-save-container').style.display = 'none';
    }

    loadWorldRanking();

    ui.resRank.innerText = info.rank;
    // 100点超えなら黄金エフェクト
    if (state.score >= 100) ui.resRank.classList.add('gold-text');
    else ui.resRank.classList.remove('gold-text');

    ui.resScore.innerText = state.score;
    ui.resBest.innerText = state.bestScore;
    ui.resMsg.innerText = info.msg;
    ui.overlay.style.display = 'flex';
    setTimeout(() => ui.overlay.classList.add('visible'), 50);
}

function getRankInfo(diff, score) {
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
    document.querySelectorAll('.block').forEach(b => b.classList.remove('fade-out'));
    ui.overlay.classList.remove('visible');
    setTimeout(() => { ui.overlay.style.display = 'none'; ui.backBtn.classList.add('visible'); }, 300);
}

function resetGame() {
    state.score = 0; state.currentDiff = 15; state.isGameOver = false; state.isPeeking = false;
    ui.score.innerText = 0; ui.overlay.classList.remove('visible');
    setTimeout(() => { ui.overlay.style.display = 'none'; renderGame(); }, 300);
}