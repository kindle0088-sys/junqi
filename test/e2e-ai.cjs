/**
 * 人机对战 e2e：创建 AI 房间 → 人类玩家 socket 加入 → 走子 → 验证 AI 自动回应
 * 运行：node test/e2e-ai.cjs [期望AI走子次数]
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EXPECT_AI_MOVES = parseInt(process.argv[2] || '3', 10);

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

function waitFor(socket, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('update', handler); reject(new Error('等待 update 超时')); }, timeoutMs);
    const handler = (data) => { if (predicate(data)) { clearTimeout(timer); socket.off('update', handler); resolve(data); } };
    socket.on('update', handler);
  });
}

async function createAIGame(playerColor) {
  const res = await fetch(`${BASE}/ai-start`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `player-color=${playerColor}&player-name=人类测试员`
  });
  const gameID = res.headers.get('location').match(/\/game\/(.+)$/)[1];
  return { gameID, cookie: res.headers.get('set-cookie').split(';')[0] };
}

(async () => {
  console.log('=== 1. 创建人机对战房间（人类选蓝方，AI 红方） ===');
  const { gameID, cookie } = await createAIGame('blue');
  console.log(`  房间 ${gameID} 创建成功`);

  const sock = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise(r => sock.on('connect', r));

  // join 后应看到 AI 玩家已加入
  const pendingJoin = waitFor(sock, d => d.players && d.players.filter(p => p.joined).length === 2);
  sock.emit('join', gameID);
  const joinState = await pendingJoin;
  const aiPlayer = joinState.players.find(p => p.isAI);
  const humanPlayer = joinState.players.find(p => !p.isAI);
  check('AI 玩家已自动加入', !!aiPlayer);
  check('AI 玩家名称为"电脑 🤖"', aiPlayer && aiPlayer.name === '电脑 🤖', aiPlayer?.name);
  check('AI 玩家已完成布阵', aiPlayer && aiPlayer.isSetup === true);
  check('人类玩家已加入', !!humanPlayer && humanPlayer.joined === true);

  console.log('=== 2. 人类完成布阵 → 游戏开始 ===');
  const pendingStart = waitFor(sock, d => d.status === 'ongoing');
  sock.emit('finishSetup', gameID);
  const startState = await pendingStart;
  check('游戏开始 (ongoing)', startState.status === 'ongoing');
  check('蓝方（人类）先手', startState.activePlayer?.color === 'blue', 'active=' + startState.activePlayer?.color);

  console.log('=== 3. 人类走子 → 验证 AI 自动回应 ===');
  let aiMoves = 0;
  let lastAIState = null;
  let state = startState;
  let steps = 0;

  while (aiMoves < EXPECT_AI_MOVES && steps < 30) {
    // 轮到人类（蓝方）走
    const humanMoves = state.validMoves || [];
    check(`第${steps + 1}轮：人类有合法着法`, humanMoves.length > 0, humanMoves.length + ' 个');
    const pick = humanMoves.find(m => m.type === 'move') || humanMoves[0];
    if (!pick) break;

    // 人类走子后，等待 AI 回应（AI 会连走一步，轮到人类时说明 AI 走完了）
    const pendingAI = waitFor(sock, d => {
      // AI 走完后 activePlayer 回到人类（蓝方），且 lastMove 是 AI 走的
      return d.activePlayer?.color === 'blue' && d.lastMove && d.lastMove.startSquare !== pick.startSquare;
    }, 15000);

    sock.emit('move', { gameID, move: `${pick.startSquare} ${pick.type === 'attack' ? 'x' : '-'} ${pick.endSquare}` });
    const afterAI = await pendingAI;
    aiMoves++;
    lastAIState = afterAI;
    state = afterAI;
    steps++;
  }

  check(`AI 自动回应了 ${EXPECT_AI_MOVES} 步`, aiMoves >= EXPECT_AI_MOVES, `实际 ${aiMoves} 步`);
  check('AI 走子后轮到人类（蓝方）', lastAIState && lastAIState.activePlayer?.color === 'blue');

  console.log('=== 4. AI 走子信息 ===');
  if (lastAIState?.lastMove) {
    console.log(`  AI 最后一步: ${JSON.stringify(lastAIState.lastMove)}`);
    check('AI 最后一步是合法格式', /^[a-e][0-9]+ [x-] [a-e][0-9]+$/.test(
      `${lastAIState.lastMove.startSquare} ${lastAIState.lastMove.type === 'attack' ? 'x' : '-'} ${lastAIState.lastMove.endSquare}`));
  }

  console.log('');
  if (failures === 0) console.log('🎉 人机对战 e2e 测试通过！');
  else console.log(`⚠️ ${failures} 项失败`);
  sock.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
