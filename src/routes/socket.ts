import { Server, Socket } from 'socket.io';
import { GameStore } from '../lib/GameStore';
import { Game } from '../lib/Game';
import { AIPlayer } from '../lib/AIPlayer';
import { 
  SessionData, 
  MoveData, 
  DebugInfo, 
  ErrorResponse,
  SocketHandshake 
} from '../types';

// Helper function to safely get session from handshake
function getSession(socket: Socket): SessionData {
  return (socket.handshake as any).session as SessionData;
}

// Helper function to send filtered updates to all players in a game
function sendFilteredUpdatesToGame(gameID: string, game: Game) {
  if (!IO) return;
  
  // Get all sockets in this game room
  const room = IO.sockets.adapter.rooms.get(gameID);
  if (!room) return;
  
  // Send individual filtered updates to each player
  room.forEach(socketId => {
    const socket = IO!.sockets.sockets.get(socketId);
    if (socket) {
      const session = (socket.handshake as any).session as SessionData;
      if (session && session.playerColor) {
        // Send filtered state for this specific player
        socket.emit('update', game.getState(session.playerColor));
      }
    }
  });
}

let IO: Server | null = null;
let DB: GameStore | null = null;

// 人机对战：每个游戏的 AI 实例缓存（AIPlayer 有记忆状态，需跨步保持）
const aiPlayers: { [gameID: string]: AIPlayer } = {};
const aiTimers: { [gameID: string]: ReturnType<typeof setTimeout> } = {};

/**
 * 若当前轮到电脑玩家，延迟片刻后自动走子并广播。
 * 在 finishSetup / move 之后调用，递归触发直到轮到人类玩家。
 */
function maybeTriggerAI(gameID: string) {
  if (!DB) return;
  const game = DB.find(gameID);
  if (!game || game.status !== 'ongoing') return;

  const active = game.activePlayer;
  if (!active || !active.color) return;
  const activePlayer = game.players.find(p => p.color === active.color);
  if (!activePlayer || !activePlayer.isAI) return;

  // 已有排队中的 AI 走子，跳过（避免重复触发）
  if (aiTimers[gameID]) return;

  const thinkMs = 600 + Math.floor(Math.random() * 700); // 0.6~1.3s 思考延迟
  aiTimers[gameID] = setTimeout(() => {
    delete aiTimers[gameID];

    const g = DB?.find(gameID);
    if (!g || g.status !== 'ongoing') return;
    const curActive = g.activePlayer;
    const curPlayer = curActive?.color ? g.players.find(p => p.color === curActive.color) : null;
    if (!curPlayer?.isAI || !curActive?.color) return;

    // 获取或创建该游戏的 AI 实例（记忆状态跨步保留）
    let ai = aiPlayers[gameID];
    if (!ai) {
      ai = new AIPlayer(curActive.color);
      aiPlayers[gameID] = ai;
    }

    const moveString = ai.chooseMove(g);
    if (moveString) {
      console.log(`AI(${curActive.color}) ${gameID}: ${moveString}`);
      g.move(moveString);
      sendFilteredUpdatesToGame(gameID, g);
    }
    // AI 走完后可能又轮到 AI（理论上不会，除非是 AI vs AI），继续触发
    maybeTriggerAI(gameID);
  }, thinkMs);
}

/**
 * Add player to game
 * Emits an "update" event on success or an "error" event on failure
 */
const join = function (this: Socket, gameID: string) {
  const sess = getSession(this);
  const debugInfo: DebugInfo = {
    socketID: this.id,
    event: 'join',
    gameID: gameID,
    session: sess
  };

  // Check if user has permission to access this game
  if (gameID !== sess.gameID) {
    console.log('ERROR: Access Denied', debugInfo);
    this.emit('error', { message: "你无权加入这个房间" });
    return;
  }

  // Lookup game in database
  const game = DB?.find(gameID);

  if (!game) {
    console.log('ERROR: Game Not Found', debugInfo);
    this.emit('error', { message: "房间不存在" });
    return;
  }

  // Add user to game
  const result = game.addPlayer(sess);
  if (!result) {
    console.log('ERROR: Failed to Add Player', debugInfo);
    this.emit('error', { message: "无法加入房间" });
    return;
  }

  // Add user to a socket.io "room" that matches the game ID
  this.join(gameID);

  // Send filtered updates to all players in the game
  sendFilteredUpdatesToGame(gameID, game);

  console.log(sess.playerName + ' joined ' + gameID);
};

/*
Finish setting up pieces before allowing gameplay to begin.
*/
const finishSetup = function (this: Socket, gameID: string) {
  const sess = getSession(this);
  const debugInfo: DebugInfo = {
    socketID: this.id,
    event: 'finishSetup',
    gameID: gameID,
    session: sess
  };

  // Check if user has permission to access this game
  if (gameID !== sess.gameID) {
    console.log('ERROR: Access Denied', debugInfo);
    this.emit('error', { message: "你尚未加入这个房间" });
    return;
  }

  // Lookup game in database
  const game = DB?.find(gameID);
  if (!game) {
    console.log('ERROR: Game Not Found', debugInfo);
    this.emit('error', { message: "房间不存在" });
    return;
  }

  // Finalize setup
  const result = game.finishSetup(sess);
  if (!result) {
    console.log('ERROR: Failed to finalize setup', debugInfo);
    this.emit('error', { message: "布阵尚未完成" });
    return;
  }

  // Send filtered updates to all players in the game
  sendFilteredUpdatesToGame(gameID, game);

  // 人机对战：布阵完成后 AI 可能先手（蓝方），触发 AI 走子
  maybeTriggerAI(gameID);

  console.log(sess.playerName + ' finish setup in game ' + gameID);
};

/**
 * Apply move to game
 * Emits an "update" event on success or an "error" event on failure
 */
const move = function (this: Socket, data: MoveData) {
  const sess = getSession(this);
  const debugInfo: DebugInfo = {
    socketID: this.id,
    event: 'move',
    gameID: data.gameID,
    move: data.move,
    session: sess
  };

  // Check if user has permission to access this game
  if (data.gameID !== sess.gameID) {
    console.log('ERROR: Access Denied', debugInfo);
    this.emit('error', { message: "你尚未加入这个房间" });
    return;
  }

  // Lookup game in database
  const game = DB?.find(data.gameID);
  if (!game) {
    console.log('ERROR: Game Not Found', debugInfo);
    this.emit('error', { message: "房间不存在" });
    return;
  }

  // Apply move to game
  const result = game.move(data.move);
  if (!result) {
    console.log('ERROR: Failed to Apply Move', debugInfo);
    this.emit('error', { message: "无效的走法，请重试" });
    return;
  }

  // Send filtered updates to all players in the game
  sendFilteredUpdatesToGame(data.gameID, game);

  // 人机对战：人类玩家走完后轮到 AI，触发 AI 走子
  maybeTriggerAI(data.gameID);

  console.log(data.gameID + ' ' + sess.playerName + ': ' + data.move);
};

/**
 * Forfeit a game
 * Emits an "update" event on success or an "error" event on failure
 */
const forfeit = function (this: Socket, gameID: string) {
  const sess = getSession(this);
  const debugInfo: DebugInfo = {
    socketID: this.id,
    event: 'forfeit',
    gameID: gameID,
    session: sess
  };

  // Check if user has permission to access this game
  if (gameID !== sess.gameID) {
    console.log('ERROR: Access Denied', debugInfo);
    this.emit('error', { message: "你尚未加入这个房间" });
    return;
  }

  // Lookup game in database
  const game = DB?.find(gameID);
  if (!game) {
    console.log('ERROR: Game Not Found', debugInfo);
    this.emit('error', { message: "房间不存在" });
    return;
  }

  // Forfeit game
  const result = game.forfeit(sess);
  if (!result) {
    console.log('ERROR: Failed to Forfeit', debugInfo);
    this.emit('error', { message: "认输失败，请重试" });
    return;
  }

  // Send filtered updates to all players in the game
  sendFilteredUpdatesToGame(gameID, game);

  console.log(gameID + ' ' + sess.playerName + ': Forfeit');
};

/**
 * Remove player from game
 */
const disconnect = function (this: Socket) {
  const sess = getSession(this);
  const debugInfo: DebugInfo = {
    socketID: this.id,
    event: 'disconnect',
    session: sess
  };

  // Lookup game in database
  const game = DB?.find(sess.gameID);
  if (!game) {
    console.log('ERROR: Game Not Found', debugInfo);
    return;
  }

  // Remove player from game
  const result = game.removePlayer(sess);
  if (!result) {
    console.log('ERROR: ' + sess.playerName + ' failed to leave ' + sess.gameID);
    return;
  }

  console.log(sess.playerName + ' left ' + sess.gameID);
  console.log('Socket ' + this.id + ' disconnected');
};

/**
 * Attach route/event handlers for socket.io
 */
export function attach(io: Server, db: GameStore): void {
  IO = io;
  DB = db;

  // When a new socket connection is made
  io.sockets.on('connection', function (socket: Socket) {
    // Attach the event handlers
    socket.on('join', join);
    socket.on('finishSetup', finishSetup);
    socket.on('move', move);
    socket.on('forfeit', forfeit);
    socket.on('disconnect', disconnect);

    console.log('Socket ' + socket.id + ' connected');
  });
}

