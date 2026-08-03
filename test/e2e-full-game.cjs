/**
 * 全自动对局：两个 socket 客户端轮流随机走子，直到游戏结束。
 * 运行：node e2e-full-game.cjs [局数] [每局最大步数]
 * 例：node e2e-full-game.cjs 3 200   → 打 3 局，每局最多 200 步
 */
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';
const GAMES = parseInt(process.argv[2] || '1', 10);
const MAX_STEPS = parseInt(process.argv[3] || '300', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitFor(socket, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('update', handler);
      reject(new Error('等待 update 超时'));
    }, timeoutMs);
    const handler = (data) => {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off('update', handler);
        resolve(data);
      }
    };
    socket.on('update', handler);
  });
}

async function createGame(playerName) {
  const res = await fetch(`${BASE}/start`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `player-color=blue&player-name=${encodeURIComponent(playerName)}`
  });
  const loc = res.headers.get('location');
  const gameID = loc.match(/\/game\/(.+)$/)[1];
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { gameID, cookie };
}

async function joinGame(gameID, playerName) {
  const res = await fetch(`${BASE}/join`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `game-id=${gameID}&player-name=${encodeURIComponent(playerName)}`
  });
  return { cookie: res.headers.get('set-cookie').split(';')[0] };
}

// 简单随机走子策略：优先攻击，其次移动
function pickMove(validMoves) {
  if (!validMoves || validMoves.length === 0) return null;
  const attack = validMoves.filter(m => m.type === 'attack');
  const pool = attack.length > 0 ? attack : validMoves;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function playOneGame(gameNo) {
  const { gameID, cookie: cookieA } = await createGame('AI 蓝');
  const { cookie: cookieB } = await joinGame(gameID, 'AI 红');

  const sockA = io(BASE, { extraHeaders: { Cookie: cookieA }, transports: ['websocket'] });
  const sockB = io(BASE, { extraHeaders: { Cookie: cookieB }, transports: ['websocket'] });
  await Promise.all([
    new Promise(r => sockA.on('connect', r)),
    new Promise(r => sockB.on('connect', r))
  ]);

  const errA = []; sockA.on('error', e => errA.push(e));
  const errB = []; sockB.on('error', e => errB.push(e));

  // 加入 + 布阵
  const p1 = waitFor(sockA, d => d.players && d.players.filter(p => p.joined).length === 2);
  sockA.emit('join', gameID); sockB.emit('join', gameID);
  await p1;

  const p2 = waitFor(sockA, d => d.status === 'ongoing');
  sockA.emit('finishSetup', gameID); sockB.emit('finishSetup', gameID);
  const startState = await p2;

  // 自动对局：状态连续流转，不额外等待"下一个事件"
  let steps = 0;
  let state = startState;

  while (steps < MAX_STEPS && state.status === 'ongoing') {
    const mover = state.activePlayer?.color === 'blue' ? sockA : sockB;
    const other = mover === sockA ? sockB : sockA;

    const move = pickMove(state.validMoves);
    if (!move) break;

    const symbol = move.type === 'attack' ? 'x' : '-';
    steps++;

    const pNext = waitFor(other, d => (d.activePlayer?.color === (mover === sockA ? 'red' : 'blue')) || d.status !== 'ongoing', 6000);
    mover.emit('move', { gameID, move: `${move.startSquare} ${symbol} ${move.endSquare}` });
    state = await pNext;
  }
  const finalState = state.status === 'ongoing' ? null : state;

  // 统计剩余棋子：board 里 colorChar 存在即可数（对方棋子 rank 是 hidden 但 colorChar 保留）
  const result = {
    gameNo,
    gameID,
    steps,
    status: finalState ? finalState.status : 'timeout',
    lastMove: finalState?.lastMove || null,
    bluePieces: null,
    redPieces: null,
    errors: [...errA, ...errB]
  };
  if (finalState) {
    const board = finalState.board || {};
    result.bluePieces = Object.values(board).filter(p => p && p.colorChar === 'b').length;
    result.redPieces = Object.values(board).filter(p => p && p.colorChar === 'r').length;
  }

  sockA.close(); sockB.close();
  return result;
}

(async () => {
  const results = [];
  for (let i = 1; i <= GAMES; i++) {
    const r = await playOneGame(i);
    results.push(r);
    console.log(`第${r.gameNo}局 #${r.gameID} 步数=${r.steps} 结局=${r.status} 蓝余${r.bluePieces} 红余${r.redPieces} 最后一步=${r.lastMove ? JSON.stringify(r.lastMove) : '—'}${r.errors.length ? ' 错误=' + JSON.stringify(r.errors) : ''}`);
  }

  const wins = results.filter(r => r.status === 'checkmate' || r.status === 'nopieces' || r.status === 'forfeit').length;
  const timeouts = results.filter(r => r.status === 'timeout').length;
  console.log(`\n${results.length} 局完成: 正常结束 ${wins} 局, 步数超限 ${timeouts} 局`);
  if (timeouts > 0) console.log('⚠️ 有对局步数超限未结束（随机走子可能原地打转，正常现象，但值得关注）');
  if (results.some(r => r.errors.length > 0)) console.log('⚠️ 对局中出现 socket error，见上方明细');
  process.exit(wins + timeouts === results.length ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
