/**
 * 端到端联机测试：HTTP 建房间/加入 + Socket.IO 双客户端走完整流程
 * 运行：node .e2e-online.cjs
 */
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

// ---- HTTP 层：创建 + 加入房间，拿到两个独立 session ----
async function startGame() {
  const res = await fetch(`${BASE}/start`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'player-color=blue&player-name=测试蓝方'
  });
  if (res.status !== 302) throw new Error('start 未返回 302, status=' + res.status);
  const loc = res.headers.get('location');
  const gameID = loc.match(/\/game\/(.+)$/)[1];
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { gameID, cookie, name: '测试蓝方' };
}

async function joinGame(gameID) {
  const res = await fetch(`${BASE}/join`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `game-id=${gameID}&player-name=测试红方`
  });
  if (res.status !== 302) throw new Error('join 未返回 302, status=' + res.status);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { cookie, name: '测试红方' };
}

// ---- 工具：等待某个 update 满足条件 ----
function waitFor(socket, predicate, timeoutMs = 5000) {
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

// ---- 主流程 ----
(async () => {
  console.log('=== 1. HTTP 建房间/加入 ===');
  const { gameID, cookie: cookieA } = await startGame();
  const { cookie: cookieB } = await joinGame(gameID);
  console.log(`  房间 ${gameID} 创建成功，两个 session 已建立`);
  check('cookie 已含 connect.sid', cookieA.startsWith('connect.sid=') && cookieB.startsWith('connect.sid='));

  console.log('=== 2. Socket 双连接 + join ===');
  const sockA = io(BASE, { extraHeaders: { Cookie: cookieA }, transports: ['websocket'] });
  const sockB = io(BASE, { extraHeaders: { Cookie: cookieB }, transports: ['websocket'] });
  const connectedA = new Promise(r => sockA.on('connect', r));
  const connectedB = new Promise(r => sockB.on('connect', r));
  await Promise.all([connectedA, connectedB]);
  check('双方 socket 已连接', true);

  const errA = []; sockA.on('error', (e) => errA.push(e));
  const errB = []; sockB.on('error', (e) => errB.push(e));

  // 注意：先挂监听再发事件，避免事件在监听注册前送达
  const pendingJoinA = waitFor(sockA, d => d.players && d.players.filter(p => p.joined).length === 2);
  sockA.emit('join', gameID);
  sockB.emit('join', gameID);
  const stateA = await pendingJoinA;
  check('双方 join 后 status=pending', stateA.status === 'pending', 'status=' + stateA.status);
  check('双方玩家名正确', stateA.players.every(p => p.name && p.name.includes('测试')), stateA.players.map(p => p.name).join(','));

  console.log('=== 3. 布阵完成 → 开战 ===');
  const pendingStart = waitFor(sockA, d => d.status === 'ongoing');
  sockA.emit('finishSetup', gameID);
  sockB.emit('finishSetup', gameID);
  const stateStart = await pendingStart;
  check('双方布阵后 status=ongoing', stateStart.status === 'ongoing');
  check('蓝方先手 (activePlayer=blue)', stateStart.activePlayer && stateStart.activePlayer.color === 'blue', JSON.stringify(stateStart.activePlayer));

  console.log('=== 4. 蓝方走子（从合法着法列表挑一个） ===');
  const validBlue = stateStart.validMoves || [];
  check('服务器下发合法着法列表', validBlue.length > 0, validBlue.length + ' 个着法');
  // 找一个 move 类型（非攻击）的着法
  const moveOp = validBlue.find(m => m.type === 'move');
  const attackOp = validBlue.find(m => m.type === 'attack');
  const pick = moveOp || attackOp;
  check('存在可用的着法', !!pick, pick ? `${pick.startSquare} ${pick.type} ${pick.endSquare}` : '无');
  if (pick) {
    const symbol = pick.type === 'attack' ? 'x' : '-';
    const pendingAfter = waitFor(sockA, d => d.activePlayer && d.activePlayer.color === 'red');
    sockA.emit('move', { gameID, move: `${pick.startSquare} ${symbol} ${pick.endSquare}` });
    const stateAfter = await pendingAfter;
    check('蓝方走子后轮到红方', stateAfter.activePlayer.color === 'red', `lastMove=${JSON.stringify(stateAfter.lastMove)}`);
  }

  console.log('=== 5. 红方走子 ===');
  const validRed = (await new Promise(r => { let h = (d) => { if (d.validMoves && d.validMoves.length >= 0 && d.activePlayer && d.activePlayer.color === 'red') { sockB.off('update', h); r(d); } }; sockB.on('update', h); })).validMoves;
  const redMove = validRed.find(m => m.type === 'move') || validRed[0];
  check('红方有合法着法', !!redMove, redMove ? `${redMove.startSquare} ${redMove.type} ${redMove.endSquare}` : '无');
  if (redMove) {
    sockB.emit('move', { gameID, move: `${redMove.startSquare} ${redMove.type === 'attack' ? 'x' : '-'} ${redMove.endSquare}` });
    const st = await waitFor(sockB, d => d.activePlayer && d.activePlayer.color === 'blue');
    check('红方走子后轮回到蓝方', st.activePlayer.color === 'blue');
  }

  console.log('=== 6. 非法走子被拒 ===');
  const errPromise = new Promise(r => sockA.once('error', r));
  sockA.emit('move', { gameID, move: 'a1 - a2' }); // 大概率非法（a1 是地雷/初始位），观察是否被拒
  const err = await Promise.race([errPromise, new Promise(r => setTimeout(() => r(null), 2000))]);
  check('非法着法返回中文错误', err && err.message.includes('无效'), err ? err.message : '未收到错误(可能着法恰好合法)');

  console.log('=== 7. 认输流程 ===');
  sockB.emit('forfeit', gameID);
  const finalState = await waitFor(sockA, d => d.status === 'forfeit');
  check('认输后 status=forfeit', finalState.status === 'forfeit');
  const youB = finalState.players.find(p => p.color === 'blue');
  const oppB = finalState.players.find(p => p.color === 'red');
  check('蓝方(测试蓝方)获胜', youB && !youB.forfeited && oppB && oppB.forfeited);

  console.log('=== 8. 断开重连：重新加入房间 ===');
  sockA.close(); sockB.close();
  const sockC = io(BASE, { extraHeaders: { Cookie: cookieA }, transports: ['websocket'] });
  await new Promise(r => sockC.on('connect', r));
  sockC.emit('join', gameID);
  const rejoinState = await waitFor(sockC, d => d.status === 'forfeit');
  check('断线后重新加入房间成功', rejoinState.status === 'forfeit');
  sockC.close();

  console.log('');
  if (failures === 0) {
    console.log('🎉 全部联机流程测试通过！');
  } else {
    console.log(`⚠️  ${failures} 项失败`);
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
