import { BoardRenderer } from "./lib/BoardRenderer.js";
import SocketManager from './lib/SocketManager.js';
import GameUIManager from './lib/GameUIManager.js';
import {
    BOARD_ROWS,
    BOARD_COLUMNS,
    MIN_RANK,
    MAX_RANK,
    MAX_MOVABLE_RANK,
    RANK_PREFIX,
    CSS_CLASSES,
    MOVE_SYMBOLS,
    GAME_STATUS,
    GAME_OVER_TYPES,
    ELEMENT_IDS,
    SELECTORS
} from './lib/constants.js';

let gameState = null;
let gameID = null;
let playerColor = null;
let gameClasses = null;

// 军衔等级 → 中文名（与 CSS 棋子名映射一致）
const RANK_LABELS = {
    0: '炸', 1: '司机', 2: '军长', 3: '师长', 4: '旅长',
    5: '团长', 6: '营长', 7: '连长', 8: '排长', 9: '工兵',
    10: '雷', 11: '旗'
};

const boardRenderer = new BoardRenderer();
const socketManager = new SocketManager();
const uiManager = new GameUIManager();

/**
 * Initialize the UI
 */
const init = (config) => {
    gameID = config.gameID;
    playerColor = config.playerColor;

    uiManager.setPlayerColor(playerColor);

    const boardHtml = boardRenderer.generateBoardHtml(BOARD_ROWS, BOARD_COLUMNS);
    const squares = uiManager.initBoard(boardHtml);
    uiManager.initModals();

    gameClasses = boardRenderer.generateAllGameClasses();

    // Create socket connection and join game
    socketManager.connect(gameID);

    // Subscribe to socket events
    socketManager.on('update', (data) => {
        gameState = data;
        update();
    });

    socketManager.on('error', (data) => {
        uiManager.showErrorMessage(data);
    });

    // Define board based on player's perspective
    boardRenderer.assignSquareIds(squares, playerColor);

    // Add visual markers for special squares
    initBoardMarkers(squares);

    // Attach event handlers
    attachDOMEventHandlers();
};

/**
 * Add visual markers for bunker, headquarters, and railway squares.
 */
const initBoardMarkers = (squares) => {
    const bunkerIds = ['b3','d3','c4','b5','d5','b8','d8','c9','b10','d10'];
    const hqIds = ['b1','d1','b12','d12'];
    const leftRailCols = ['a'];  // left rail column
    const rightRailCols = ['e']; // right rail column
    const railRows = ['2','3','4','5','6','7','8','9','10','11'];
    const railTopRows = ['2','6','7'];  // top rail for these complete rows
    const railBottomRows = ['6','7','11']; // bottom rail

    squares.each(function() {
        const id = $(this).attr('id');
        if (!id) return;

        // Bunker
        if (bunkerIds.includes(id)) {
            $(this).addClass('bunker');
        }
        // Headquarters
        if (hqIds.includes(id)) {
            $(this).addClass('hq');
        }
        // Railway - left/right columns
        const col = id[0];
        const row = id.slice(1);
        if (leftRailCols.includes(col) && railRows.includes(row)) {
            $(this).addClass('rail-left');
        }
        if (rightRailCols.includes(col) && railRows.includes(row)) {
            $(this).addClass('rail-right');
        }
        // Railway - top/bottom rows
        if (railTopRows.includes(row)) {
            $(this).addClass('rail-top');
        }
        if (railBottomRows.includes(row)) {
            $(this).addClass('rail-bottom');
        }
    });
};

const callbackHighlightSwap = (color, rank) => {
    return (ev) => {
        //for setup, swap pieces
        for (let i = 0; i < gameState.players.length; i++) {
            if (gameState.players[i].color === playerColor && gameState.players[i].isSetup === false) {
                uiManager.highlightValidSwap(gameState, color + rank, ev.target);
            }
        }
    };
};

const callbackHighlightMoves = (color, rank) => {
    return (ev) => {
        //Show moves for player
        if (gameState.activePlayer && gameState.activePlayer.color === playerColor) {
            uiManager.highlightValidMoves(gameState, color + rank, ev.target);
        }
    };
};

/**
 * Attach all DOM event handlers
 */
const attachDOMEventHandlers = () => {
    attachSetupHandlers();
    attachGameHandlers();
    attachControlHandlers();
};

/**
 * Attach setup phase event handlers (piece swapping, finish setup)
 */
const attachSetupHandlers = () => {
    const baseString = `.${playerColor}.${RANK_PREFIX}`;

    // All pieces can be swapped during setup
    for (let i = MIN_RANK; i <= MAX_RANK; i++) {
        uiManager.gameRoot.on('click', `${baseString}${i}`, callbackHighlightSwap(playerColor[0], i.toString()));
    }

    // Swap pieces
    uiManager.gameRoot.on('click', SELECTORS.VALID_SWAP, (ev) => {
        const m = uiManager.getSwapString();
        uiManager.clearMessages();
        socketManager.sendMove(gameID, m);
    });

    // Finish setup
    uiManager.gameRoot.on('click', `#${ELEMENT_IDS.FINISH_SETUP}`, (ev) => {
        socketManager.finishSetup(gameID);
    });
};

/**
 * Attach game phase event handlers (move highlighting, move execution, attacks)
 */
const attachGameHandlers = () => {
    const baseString = `.${playerColor}.${RANK_PREFIX}`;

    // Only highlight movable pieces during gameplay
    for (let i = MIN_RANK; i < MAX_MOVABLE_RANK; i++) {
        uiManager.gameRoot.on('click', `${baseString}${i}`, callbackHighlightMoves(playerColor[0], i.toString()));
    }

    // Perform a regular move
    uiManager.gameRoot.on('click', SELECTORS.VALID_MOVE, (ev) => {
        const m = generateMoveString(ev.target, MOVE_SYMBOLS.MOVE);
        uiManager.clearMessages();
        socketManager.sendMove(gameID, m);
    });

    // Attack the opponent's piece
    uiManager.gameRoot.on('click', SELECTORS.VALID_ATTACK, (ev) => {
        const m = generateMoveString(ev.target, MOVE_SYMBOLS.ATTACK);
        uiManager.clearMessages();
        socketManager.sendMove(gameID, m);
    });
};

/**
 * Attach control event handlers (forfeit, clear highlights)
 */
const attachControlHandlers = () => {
    // Clear all move highlights
    uiManager.gameRoot.on('click', SELECTORS.EMPTY, (ev) => {
        uiManager.clearHighlights();
    });

    // Forfeit game
    uiManager.gameRoot.on('click', `#${ELEMENT_IDS.FORFEIT}`, (ev) => {
        uiManager.showForfeitPrompt((confirmed) => {
            if (confirmed) {
                uiManager.clearMessages();
                socketManager.forfeit(gameID);
            }
        });
    });
};

const generateMoveString = (destinationSquare, symbol) => {
    const selection = uiManager.getSelection();
    const piece = selection.pieceStr;
    const src = uiManager.getElement(selection.squareId);
    const dest = uiManager.getElementFromDOM(destinationSquare);

    uiManager.clearHighlights();

    const pieceClass = boardRenderer.getPieceClasses(piece, playerColor, gameState);

    // Move piece on board
    src.removeClass(pieceClass).addClass(CSS_CLASSES.EMPTY);
    dest.removeClass(CSS_CLASSES.EMPTY).addClass(pieceClass);

    // Return move string
    return selection.squareId + ' ' + symbol + ' ' + dest.attr('id');
};

/**
 * Identify the current player and opponent from game state
 * @param {Object} gameState - The current game state
 * @param {string} playerColor - The current player's color
 * @returns {Object} Object with 'you' and 'opponent' player objects
 */
const identifyPlayers = (gameState, playerColor) => {
    const you = gameState.players.find(p => p.color === playerColor);
    const opponent = gameState.players.find(p => p.color !== playerColor);
    return { you, opponent };
};

/**
 * 渲染"已吃对手"棋子清单
 * @param {Array} capturedPieces - 我吃掉的对方棋子（含 colorChar / rank）
 */
const renderCapturedPieces = (capturedPieces) => {
    const container = document.getElementById('you-captures');
    if (!container) return;

    const pieces = capturedPieces || [];
    if (pieces.length === 0) {
        container.innerHTML = '<span class="captures-empty">暂无战果</span>';
        return;
    }

    // 按吃子顺序展示（最新在前）
    const reversed = [...pieces].reverse();
    container.innerHTML = reversed.map(p => {
        const colorClass = p.colorChar === 'r' ? 'cap-red' : 'cap-blue';
        const label = RANK_LABELS[p.rank] !== undefined ? RANK_LABELS[p.rank] : p.rank;
        return `<span class="capture-chip ${colorClass}" title="吃掉了对方的${label}">${label}</span>`;
    }).join('');
};

/**
 * 更新回合状态条
 * @param {Object} gameState - 游戏状态
 * @param {string} activeColor - 当前行动方颜色
 */
const updateTurnBanner = (gameState, activeColor) => {
    const banner = document.getElementById('turn-banner');
    const text = document.getElementById('turn-text');
    if (!banner || !text) return;

    const you = gameState.players.find(p => p.color === playerColor);
    const opponent = gameState.players.find(p => p.color !== playerColor);

    // 布阵阶段
    if (gameState.status === 'pending') {
        if (you && you.isSetup === false) {
            banner.className = 'turn-banner turn-setup';
            text.textContent = '布阵中 · 点击棋子交换位置，然后完成布阵';
        } else if (opponent && opponent.isSetup === false) {
            banner.className = 'turn-banner turn-opponent';
            text.textContent = '等待对手布阵…';
        } else {
            banner.className = 'turn-banner turn-setup';
            text.textContent = '双方就绪，即将开始！';
        }
        return;
    }

    // 对局进行中
    if (activeColor === playerColor) {
        banner.className = 'turn-banner turn-mine';
        text.textContent = '⚡ 轮到你了，请行动！';
    } else {
        banner.className = 'turn-banner turn-opponent';
        text.textContent = '对方思考中…';
    }
};

/**
 * Update UI from game state
 */
const update = () => {
    const activeColor = gameState.activePlayer?.color;

    // Update player info
    uiManager.updatePlayerPanels(gameState.players, activeColor, gameState.status);

    // Update captured pieces (the ones I've eaten from opponent)
    renderCapturedPieces(gameState.capturedPieces);

    // Update turn banner
    updateTurnBanner(gameState, activeColor);

    // Update board
    uiManager.renderBoard(gameState.board, playerColor, gameState, boardRenderer, gameClasses);

    // Highlight last move
    uiManager.highlightLastMove(gameState.lastMove);

    // Identify you and opponent
    const { you, opponent } = identifyPlayers(gameState, playerColor);

    // Test for checkmate
    if (gameState.status === GAME_STATUS.CHECKMATE) {
        if (opponent.inCheck) { uiManager.showGameOver(GAME_OVER_TYPES.CHECKMATE_WIN); }
        if (you.inCheck) { uiManager.showGameOver(GAME_OVER_TYPES.CHECKMATE_LOSE); }
    }

    // Test for stalemate
    if (gameState.status === GAME_STATUS.NOPIECES) {
        if (!opponent.hasMoveablePieces) { uiManager.showGameOver(GAME_OVER_TYPES.NOPIECES_WIN); }
        if (!you.hasMoveablePieces) { uiManager.showGameOver(GAME_OVER_TYPES.NOPIECES_LOSE); }
    }

    // Test for forfeit
    if (gameState.status === GAME_STATUS.FORFEIT) {
        if (opponent.forfeited) { uiManager.showGameOver(GAME_OVER_TYPES.FORFEIT_WIN); }
        if (you.forfeited) { uiManager.showGameOver(GAME_OVER_TYPES.FORFEIT_LOSE); }
    }
};

const Client = init;

export default Client;