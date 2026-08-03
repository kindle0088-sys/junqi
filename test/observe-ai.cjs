// 观察 AI 开局策略（人类随机走子 vs AI）
const { io } = require('socket.io-client');
const BASE = 'http://localhost:3000';

const waitFor = (socket, pred, ms = 15000) => new Promise((res, rej) => {
  const t = setTimeout(() => { socket.off('update', h); rej(new Error('超时')); }, ms);
  const h = (d) => { if (pred(d)) { clearTimeout(t); socket.off('update', h); res(d); } };
  socket.on('update', h);
});

(async () => {
  const r = await fetch(BASE + '/ai-start', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'player-color=red&player-name=观察员' });
  const gid = r.headers.get('location').match(/\/game\/(.+)$/)[1];
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const sock = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise(r2 => sock.on('connect', r2));

  const p1 = waitFor(sock, d => d.players && d.players.filter(p => p.joined).length === 2);
  sock.emit('join', gid); await p1;

  // 人类红方布阵，等 AI 蓝方先走一步
  const p2 = waitFor(sock, d => d.status === 'ongoing' && d.lastMove && d.activePlayer?.color === 'red', 20000);
  sock.emit('finishSetup', gid);
  let state = await p2;
  console.log('AI 先手第一步:', state.lastMove.startSquare + ' -> ' + state.lastMove.endSquare + ' (' + state.lastMove.type + ')');

  console.log('回合 | AI(蓝) 着法 | 人类(红) 着法');
  console.log('-----|------------|------------');
  for (let i = 0; i < 6; i++) {
    const humanMoves = state.validMoves;
    if (!humanMoves || humanMoves.length === 0) { console.log('无着法，终局？'); break; }
    const pick = humanMoves[Math.floor(Math.random() * humanMoves.length)];
    const humanStr = pick.startSquare + ' ' + (pick.type === 'attack' ? 'x' : '-') + ' ' + pick.endSquare;

    // 人类走
    const pNext = waitFor(sock, d => d.lastMove && d.lastMove.startSquare === pick.startSquare && d.lastMove.endSquare === pick.endSquare, 15000);
    sock.emit('move', { gameID: gid, move: humanStr });
    await pNext;

    // 等 AI 回应（lastMove 变成 AI 走的）
    const pAI = waitFor(sock, d => d.lastMove && (d.lastMove.startSquare !== pick.startSquare || d.lastMove.endSquare !== pick.endSquare), 15000);
    const st2 = await pAI;
    const aiStr = st2.lastMove.startSquare + ' ' + (st2.lastMove.type === 'attack' ? 'x' : '-') + ' ' + st2.lastMove.endSquare;
    console.log(`第${i + 1}回合 | ${aiStr} | ${humanStr}`);
    state = st2;
  }
  sock.close();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
