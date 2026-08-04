import { strict as assert } from 'assert';
import { Game } from '../src/lib/Game';
import { PlayerSession } from '../src/types';

describe('Game', function () {
  describe('#parseMoveString()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var gameBlueSide = new Game({
      playerName: '',
      playerColor: 'blue'
    });

    it('Convert move string into object', function () {
      var playerMove = gameRedSide.parseMoveString("a1 - b1");
      assert.ok(playerMove !== null);
      assert.equal(playerMove.type, "move");
      assert.equal(playerMove.startSquare, "a1");
      assert.equal(playerMove.endSquare, "b1");
    });

    it('Convert attack string into object', function () {
      var playerAttack = gameRedSide.parseMoveString("a1 x b1");
      assert.ok(playerAttack !== null);
      assert.equal(playerAttack.type, "attack");
      assert.equal(playerAttack.startSquare, "a1");
      assert.equal(playerAttack.endSquare, "b1");
    });

    it('Convert swap string into object', function () {
      var playerSwap = gameRedSide.parseMoveString("a1 s b1");
      assert.ok(playerSwap !== null);
      assert.equal(playerSwap.type, "swap");
      assert.equal(playerSwap.startSquare, "a1");
      assert.equal(playerSwap.endSquare, "b1");
    });

    it('Convert unknown string', function () {
      var unknownString = gameRedSide.parseMoveString("a1 ? b1");
      assert.equal(unknownString, null);
    });
  });

  describe('#addPlayer()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var redPlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'red' as const,
    };
    var bluePlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'blue' as const,
    };

    it('Join game twice as same color', function () {
      // Joining first time as red
      var status = gameRedSide.addPlayer(redPlayerSession);
      assert.equal(status, true);

      // Joining second time as red
      var status = gameRedSide.addPlayer(redPlayerSession);
      assert.equal(status, false);

      // Join as different color
      var status = gameRedSide.addPlayer(bluePlayerSession);
      assert.equal(status, true);
    });
  });

  describe('#removePlayer()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var redPlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'red' as const,
    };
    var bluePlayerNotJoined: PlayerSession = {
      playerName: '',
      playerColor: 'blue' as const,
    };

    it('Join and leave game', function () {
      // Red player
      assert.equal(gameRedSide.players[0].joined, false);

      var status = gameRedSide.addPlayer(redPlayerSession);
      assert.equal(status, true);
      assert.equal(gameRedSide.players[0].joined, true);

      var status = gameRedSide.removePlayer(redPlayerSession);
      assert.equal(status, true);
      assert.equal(gameRedSide.players[0].joined, false);
    });

    it('Player who has not joined cannot be removed', function () {
      // Try to remove a player who hasn't joined yet
      var status = gameRedSide.removePlayer(bluePlayerNotJoined);
      assert.equal(status, false);
    })
  });

  describe('#swapPieces()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });

    it('Swap pieces', function () {
      // Valid move
      var status = gameRedSide.swapPieces("a1 s a2");
      assert.equal(status, true);

      // Invalid move
      var status = gameRedSide.swapPieces("a1 s unknown");
      assert.equal(status, false);
    });
  });

  describe('#finishSetup()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var redPlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'red' as const,
    };
    var bluePlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'blue' as const,
    }
    var status = gameRedSide.addPlayer(redPlayerSession);
    var status = gameRedSide.addPlayer(bluePlayerSession);
    assert.equal(gameRedSide.status, "pending");

    it('Finish game setup', function () {
      var status = gameRedSide.finishSetup(redPlayerSession);
      assert.equal(status, true);
      assert.equal(gameRedSide.status, "pending");

      var status = gameRedSide.finishSetup(bluePlayerSession);
      assert.equal(status, true);
      assert.equal(gameRedSide.status, "ongoing");
    });

    it('Player who has not joined cannot finish setup', function () {
      // Create a fresh game instance for this test
      var freshGame = new Game({
        playerName: '',
        playerColor: 'red'
      });
      
      // Try to finish setup for a player who hasn't joined yet
      var status = freshGame.finishSetup({
        playerName: 'Player Not Joined',
        playerColor: 'blue' as const
      });
      assert.equal(status, false);
    })
  });

  describe('#move()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var redPlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'red' as const,
    };
    var bluePlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'blue' as const,
    }
    gameRedSide.addPlayer(redPlayerSession);
    gameRedSide.addPlayer(bluePlayerSession);
    gameRedSide.finishSetup(redPlayerSession);
    gameRedSide.finishSetup(bluePlayerSession);

    it('Red player moves', function () {
      var status = gameRedSide.move("a6 x a7");
      assert.equal(status, true);
      assert.equal(gameRedSide.validSwap.length, 0);
    });
  });

  describe('#move() checkmate priority', function () {
    it('Flag capture wins over no-moveable-pieces', function () {
      // 构造终局：红方只剩军旗+2地雷（无棋可走），蓝方司令在 b11 准备吃旗
      // 吃旗后红方同时满足 inCheck 和 hasMoveablePieces=false，
      // 状态必须报 checkmate（军旗被吃优先级最高），而不是 nopieces
      const { Piece, PieceRank } = require('../src/lib/Piece') as any;
      const game = new Game({ playerName: '', playerColor: 'blue' });
      game.board.boardState = {
        b12: new Piece('r', PieceRank.FLAG),
        a12: new Piece('r', PieceRank.LANDMINE),
        c12: new Piece('r', PieceRank.LANDMINE),
        b11: new Piece('b', PieceRank.COMMANDER)
      };
      game.players[0].isSetup = true;
      game.players[1].isSetup = true;
      game.status = 'ongoing';
      game.activePlayer = game.players[0];
      game.validMoves = [{ type: 'attack', startSquare: 'b11', endSquare: 'b12' }];

      const ok = game.move('b11 x b12');
      assert.equal(ok, true);
      assert.equal(game.players[1].inCheck, true, '红方军旗应被吃');
      assert.equal(game.players[1].hasMoveablePieces, false, '红方应无棋可走');
      assert.equal(game.status, 'checkmate', '吃旗应报 checkmate 而非 nopieces');
    });
  });

  describe('#forfeit()', function () {
    var gameRedSide = new Game({
      playerName: '',
      playerColor: 'red'
    });
    var redPlayerSession: PlayerSession = {
      playerName: '',
      playerColor: 'red' as const,
    };

    it('Red player forfeits game', function () {
      // First add the red player to the game
      var addStatus = gameRedSide.addPlayer(redPlayerSession);
      assert.equal(addStatus, true);
      
      assert.equal(gameRedSide.players[0].forfeited, false);

      var status = gameRedSide.forfeit(redPlayerSession);
      assert.equal(status, true);
      assert.equal(gameRedSide.players[0].forfeited, true);
    });

    it('Player who has not joined cannot forfeit', function () {
      // Create a fresh game instance for this test
      var freshGame = new Game({
        playerName: '',
        playerColor: 'red'
      });
      
      // Try to forfeit for a player who hasn't joined yet
      var status = freshGame.forfeit({
        playerName: 'Player Not Joined',
        playerColor: 'blue' as const,
      });
      assert.equal(status, false);
    });
  });

  describe('#capturedPieces() 被动吃到/同归于尽记录', function () {
    // 基于默认 60 格开局棋盘，仅覆盖攻击/防守两个格子，保证棋盘完整（缺 key 会崩 getValidMoves）
    function makeGame(attackerSquare: string, attacker: any, defenderSquare: string, defender: any, attackerColor: 'red' | 'blue') {
      const game = new Game({ playerName: '', playerColor: attackerColor });
      game.board.boardState[attackerSquare] = attacker;
      game.board.boardState[defenderSquare] = defender;
      game.players[0].isSetup = true;
      game.players[1].isSetup = true;
      game.status = 'ongoing';
      game.activePlayer = game.players[0];
      game.validMoves = [{ type: 'attack', startSquare: attackerSquare, endSquare: defenderSquare }];
      return game;
    }

    it('防守方被动吃掉攻击者（dies）应记入已吃清单', function () {
      const { Piece, PieceRank } = require('../src/lib/Piece') as any;
      // 红方 LIEUTENANT(8) b11 攻击 蓝方 CAPTAIN(7) b12 → 红死，蓝"被动吃到"红方棋子
      const game = makeGame('b11', new Piece('r', PieceRank.LIEUTENANT), 'b12', new Piece('b', PieceRank.CAPTAIN), 'red');

      const ok = game.move('b11 x b12');
      assert.equal(ok, true);

      // 攻击方（红）视角：攻击失败没吃到任何东西，清单应为空
      const redView = game.getState('red').capturedPieces;
      assert.equal(redView.length, 0, '红方攻击失败，不应看到已吃棋子');

      // 防守方（蓝）视角：被动吃到的红方 LIEUTENANT 必须显示（本 bug 修复点）
      const blueView = game.getState('blue').capturedPieces;
      assert.equal(blueView.length, 1, '蓝方应看到被动吃掉的红军棋子');
      assert.equal(blueView[0].colorChar, 'r');
      assert.equal(blueView[0].rank, PieceRank.LIEUTENANT);
    });

    it('同归于尽（equal）双方互吃应各显示对方棋子', function () {
      const { Piece, PieceRank } = require('../src/lib/Piece') as any;
      // 红方 CAPTAIN(7) b11 攻击 蓝方 CAPTAIN(7) b12 → 同归于尽
      const game = makeGame('b11', new Piece('r', PieceRank.CAPTAIN), 'b12', new Piece('b', PieceRank.CAPTAIN), 'red');

      const ok = game.move('b11 x b12');
      assert.equal(ok, true);

      const redView = game.getState('red').capturedPieces;
      assert.equal(redView.length, 1, '红方应看到同归于尽吃掉的蓝军棋子');
      assert.equal(redView[0].colorChar, 'b');
      assert.equal(redView[0].rank, PieceRank.CAPTAIN);

      const blueView = game.getState('blue').capturedPieces;
      assert.equal(blueView.length, 1, '蓝方应看到同归于尽吃掉的红军棋子');
      assert.equal(blueView[0].colorChar, 'r');
      assert.equal(blueView[0].rank, PieceRank.CAPTAIN);
    });
  });

});
