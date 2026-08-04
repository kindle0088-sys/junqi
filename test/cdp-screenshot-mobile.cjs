/**
 * CDP 截图对局页（移动视口），带 session cookie
 * 流程：POST /ai-start 拿 gameID + cookie → 启动 Chrome remote-debug
 *       → CDP 创建 target + set cookie + navigate → 等 board 渲染 → screenshot
 *
 * 用法：node test/cdp-screenshot-mobile.cjs [outputName]
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_NAME = process.argv[2] || 'game-mobile';
const VIEWPORT_W = parseInt(process.env.VIEWPORT_W || '390', 10);
const VIEWPORT_H = parseInt(process.env.VIEWPORT_H || '844', 10);
const WAIT_MS = parseInt(process.env.WAIT_MS || '2500', 10);

const SHOTS_DIR = path.resolve(__dirname, '..', '.shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

// --- 简易 CDP 客户端 ---
let nextId = 1;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', onMsg);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 1. POST /ai-start 拿 session + gameID ===');
  const res = await fetch(`${BASE}/ai-start`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'player-color=blue&player-name=移动端测试员'
  });
  const setCookie = res.headers.get('set-cookie').split(';')[0]; // connect.sid=...
  const location = res.headers.get('location');
  const gameID = location.match(/\/game\/(.+)$/)[1];
  console.log(`  gameID = ${gameID}`);
  console.log(`  cookie  = ${setCookie.substring(0, 40)}...`);

  console.log(`=== 2. 启动 Chrome (remote-debug ${PORT}, ${VIEWPORT_W}x${VIEWPORT_H}) ===`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--window-size=${VIEWPORT_W},${VIEWPORT_H}`,
    '--user-data-dir=' + path.resolve(__dirname, '..', '.chrome-profile-' + Date.now()),
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // 等调试端口就绪
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
    try { await getTargets(); break; } catch {}
  }
  console.log('  Chrome 就绪');

  console.log('=== 3. CDP 创建 target + set cookie + navigate ===');
  const WebSocket = require('ws');
  const targets = await getTargets();
  // 用第一个 page target，或新建
  let target = targets.find(t => t.type === 'page');
  if (!target) {
    // 等一下
    await new Promise(r => setTimeout(r, 500));
    const t2 = await getTargets();
    target = t2.find(t => t.type === 'page');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  await send(ws, 'Page.enable');
  await send(ws, 'Network.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_W, height: VIEWPORT_H,
    deviceScaleFactor: 2, mobile: true,
    screenWidth: VIEWPORT_W, screenHeight: VIEWPORT_H
  });

  // 通过 Network.setCookie 设置 connect.sid
  const cookieName = setCookie.split('=')[0];
  const cookieVal = setCookie.split('=')[1];
  await send(ws, 'Network.setCookie', {
    name: cookieName, value: cookieVal,
    domain: 'localhost', path: '/', httpOnly: true
  });
  console.log(`  setCookie ${cookieName} OK`);

  // 导航
  await send(ws, 'Page.navigate', { url: `${BASE}/game/${gameID}` });

  // 等渲染
  console.log(`=== 4. 等渲染 ${WAIT_MS}ms ===`);
  await new Promise(r => setTimeout(r, WAIT_MS));

  console.log('=== 5. captureScreenshot ===');
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  const outPath = path.join(SHOTS_DIR, `${OUTPUT_NAME}.png`);
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log(`  写入 ${outPath} (${(shot.data.length * 0.75 / 1024).toFixed(1)} KB)`);

  // 顺便读 DOM 验证关键元素存在
  const dom = await send(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      boardCells: document.querySelectorAll('#board td').length,
      opponentVisible: getComputedStyle(document.getElementById('opponent-panel')).display !== 'none',
      youVisible: getComputedStyle(document.getElementById('you-panel')).display !== 'none',
      capturesVisible: !!document.getElementById('you-captures'),
      cellW: getComputedStyle(document.querySelector('#board td')).width,
      cellH: getComputedStyle(document.querySelector('#board td')).height,
      pieceW: getComputedStyle(document.querySelector('#board td.red, #board td.blue, #board td.facedown') || document.body).getPropertyValue('--piece-w').trim()
    })`,
    returnByValue: true
  });
  console.log('  DOM:', dom.result.value);

  ws.close();
  chrome.kill();
  console.log('=== 完成 ===');
  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });