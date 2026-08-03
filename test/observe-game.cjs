/**
 * 单局详细观察：打印每一步走子过程（含吃子信息），人工审视对局质量。
 * 运行：node test/observe-game.cjs [最大步数]
 */
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';
const MAX_STEPS = parseInt(process.argv[2] || '120', 10);

const RANK_NAMES = { 0:'💣炸弹', 1:'司令', 2:'军长', 3:'师长', 4:'旅长', 5:'团长', 6:'营长', 7:'连长', 8:'排长', 9:'工兵', 10:'地雷', 11:'军旗' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function waitFor(socket, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('update', handler); reject(new Error('等待 update 超时')); }, timeoutMs);
    const handler = (data) => { if (predicate(data)) { clearTimeout(timer); socket.off('update', handler); resolve(data); } };
    socket.on('update', handler);
  });
}

async function createGame() {
  const res = await fetch(`${BASE}/start`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'player-color=blue&player-name=巴迪蓝方' });
  const gameID = res.headers.get('location').match(/\/game\/(.+)$/)[1];
  return { gameID, cookie: res.headers.get('set-cookie').split(';')[0] };
}
async function joinGame(gameID) {
  const res = await fetch(`${BASE}/join`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `game-id=${gameID}&player-name=巴迪红方` });
  return { cookie: res.headers.get('set-cookie').split(';')[0] };
}

// 有目的性的走子：优先吃对方棋子（攻击有把握的），其次推进
function pickSmartMove(state, myColor) {
  const moves = state.validMoves || [];
  if (!moves.length) return null;
  // 攻击优先
  const attacks = moves.filter(m => m.type === 'attack');
  if (attacks.length) return attacks[Math.floor(Math.random() * attacks.length)];
  return moves[Math.floor(Math.random() * moves.length)];
}

(async () => {
  const { gameID, cookie: cA } = await createGame();
  const { cookie: cB } = await joinGame(gameID);
  const sA = io(BASE, { extraHeaders: { Cookie: cA }, transports: ['websocket'] });
  const sB = io(BASE, { extraHeaders: { Cookie: cB }, transports: ['websocket'] });
  await Promise.all([new Promise(r => sA.on('connect', r)), new Promise(r => sB.on('connect', r))]);

  const p1 = waitFor(sA, d => d.players && d.players.filter(p => p.joined).length === 2);
  sA.emit('join', gameID); sB.emit('join', gameID); await p1;
  const p2 = waitFor(sA, d => d.status === 'ongoing');
  sA.emit('finishSetup', gameID); sB.emit('finishSetup', gameID);
  let state = await p2;

  console.log(`🎮 对局开始 #${gameID} (蓝方先手)\n`);
  console.log('回合 | 走子方 | 着法 | 说明');
  console.log('-----|--------|------|------');

  let steps = 0;
  while (steps < MAX_STEPS && state.status === 'ongoing') {
    const mover = state.activePlayer?.color === 'blue' ? sA : sB;
    const other = mover === sA ? sB : sA;
    const myColor = state.activePlayer?.color;
    const move = pickSmartMove(state, myColor);
    if (!move) break;

    const symbol = move.type === 'attack' ? 'x' : '-';
    steps++;

    // 记录着法前该格棋子（我方可见）
    const board = state.board || {};
    const startPiece = board[move.startSquare];
    const endPiece = board[move.endSquare];
    const rankName = startPiece && startPiece.rank !== 'hidden' ? (RANK_NAMES[startPiece.rank] || startPiece.rank) : '?';

    let desc = '';
    if (move.type === 'attack') {
      desc = endPiece ? `攻击 ${endPiece.colorChar === myColor[0] ? '自己?' : '对方'}棋子` : '攻击(目标为空?)';
    } else {
      desc = '移动';
    }

    const pNext = waitFor(other, d => (d.activePlayer?.color === (mover === sA ? 'red' : 'blue')) || d.status !== 'ongoing', 6000);
    mover.emit('move', { gameID, move: `${move.startSquare} ${symbol} ${move.endSquare}` });
    state = await pNext;

    // 从新状态看吃子结果
    let outcome = '';
    const afterBoard = state.board || {};
    if (move.type === 'attack') {
      const still = afterBoard[move.endSquare];
      if (!still) outcome = ' → 同归于尽/消失';
      else if (still.colorChar === myColor[0]) outcome = ' → 吃掉对方';
      else outcome = ' → 被吃';
    }
    const moverName = myColor === 'blue' ? '蓝' : '红';
    console.log(`第${String(steps).padStart(3)}步 | ${moverName}方 | ${move.startSquare} ${symbol} ${move.endSquare} | ${rankName}${outcome}`);
  }

  console.log('\n' + '='.repeat(50));
  if (state.status === 'ongoing') {
    console.log(`⚠️ 步数超限（${MAX_STEPS} 步）对局未结束`);
  } else {
    const st = state.status;
    const loser = st === 'checkmate' ? (state.players.find(p => p.inCheck)?.color || '?') : (state.players.find(p => p.hasMoveablePieces === false)?.color || '?');
    const board = state.board || {};
    const bCount = Object.values(board).filter(p => p && p.colorChar === 'b').length;
    const rCount = Object.values(board).filter(p => p && p.colorChar === 'r').length;
    const last = state.lastMove;
    console.log(`🏁 终局: ${st} | 败方: ${loser} | 蓝余${bCount} 红余${rCount} | 最后一步: ${last ? last.startSquare + ' ' + last.type + ' ' + last.endSquare : '—'} | 共${steps}步`);
  }
  sA.close(); sB.close();
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
