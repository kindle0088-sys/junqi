import { strict as assert } from 'assert';
import { Game } from '../src/lib/Game';
import { AIPlayer } from '../src/lib/AIPlayer';
import { Piece, PieceRank } from '../src/lib/Piece';

describe('AIPlayer', function () {
  describe('基础行为', function () {
    it('有合法着法时返回 moveString', function () {
      const game = new Game({ playerName: '', playerColor: 'blue' });
      const ai = new AIPlayer('red');
      const move = ai.chooseMove(game);
      assert.ok(move, '应返回一步着法');
      assert.match(move, /^[a-e][0-9]+ [x-] [a-e][0-9]+$/);
    });

    it('无合法着法时返回 null', function () {
      const game = new Game({ playerName: '', playerColor: 'blue' });
      // 清空红方所有棋子
      Object.keys(game.board.boardState).forEach(sq => {
        const p = game.board.boardState[sq];
        if (p && p.getPieceColor() === 'r') game.board.boardState[sq] = null;
      });
      const ai = new AIPlayer('red');
      assert.equal(ai.chooseMove(game), null);
    });
  });

  describe('策略：工兵', function () {
    it('工兵优先攻击对方后排（挖雷/摸旗）', function () {
      // 完整初始棋盘，覆盖关键位置：红方（AI）工兵移到 a11，蓝方 a12 放地雷
      const game = new Game({ playerName: '', playerColor: 'blue' });
      const board = game.board.boardState;
      board.a11 = new Piece('r', PieceRank.ENGINEER);
      board.a12 = new Piece('b', PieceRank.LANDMINE);
      board.b12 = new Piece('b', PieceRank.FLAG);
      const ai = new AIPlayer('red');
      const move = ai.chooseMove(game);
      assert.ok(move);
      // 工兵应攻击 a12 地雷（而不是其他）
      assert.match(move, /a11 x a12/, '工兵应优先挖地雷，实际: ' + move);
    });

    it('无地雷可挖时工兵向对方后场移动', function () {
      const game = new Game({ playerName: '', playerColor: 'blue' });
      const board = game.board.boardState;
      board.a11 = new Piece('r', PieceRank.ENGINEER);
      const ai = new AIPlayer('red');
      const move = ai.chooseMove(game);
      assert.ok(move);
      // 工兵应沿铁路向蓝方后场移动（endSquare 的 row 应较小）
      const destRow = parseInt(move.split(' ')[2].slice(1), 10);
      assert.ok(destRow < 11, '工兵应往对方半场移动，实际目标: ' + move);
    });
  });

  describe('策略：记忆与必胜攻击', function () {
    it('弱子试探出强子位置后，派更强主力收掉', function () {
      const game = new Game({ playerName: '', playerColor: 'blue' });
      const ai = new AIPlayer('red');
      const board = game.board.boardState;
      // 场景：蓝方军长(rank 2)在 c2；红方师长(rank 3)在 c3、红方司令(rank 1)在 b2
      board.c2 = new Piece('b', PieceRank.GENERAL);          // 蓝军长（强子）
      board.c3 = new Piece('r', PieceRank.MAJOR_GENERAL);    // 红师长（试探用弱子）
      board.b2 = new Piece('r', PieceRank.COMMANDER);        // 红司令（收尾主力）

      // 模拟 AI 上一手：师长 c3 x c2 试探失败（dies），对方是军长
      game.lastMove = { type: 'dies', startSquare: 'c3', endSquare: 'c2' };
      board.c3 = null; // 师长阵亡
      (ai as any).pendingAttack = {
        moveString: 'c3 x c2',
        startSquare: 'c3',
        endSquare: 'c2',
        myRank: PieceRank.MAJOR_GENERAL // rank 3
      };

      const move = ai.chooseMove(game);
      assert.ok(move);
      // 司令(rank 1) 应去收掉已知的强子位置 c2（1 < 2 确定能赢）
      assert.match(move, /b2 x c2/, '应派更强主力收掉试探出的强子，实际: ' + move);
    });
  });

  describe('策略：高价值棋子防守', function () {
    it('司令在己方半场有安全移动时，不盲攻未知目标', function () {
      const game = new Game({ playerName: '', playerColor: 'blue' });
      const board = game.board.boardState;
      board.e8 = new Piece('r', PieceRank.COMMANDER); // 红司令在 e8（己方半场）
      board.e7 = new Piece('b', PieceRank.CAPTAIN);   // 蓝方未知棋子（连长）
      const ai = new AIPlayer('red');
      const move = ai.chooseMove(game);
      assert.ok(move);
      // 司令不应参与盲攻未知目标（低价值棋子可以去试探，但司令要惜命）
      assert.ok(!/e8 x/.test(move), '司令不应盲攻未知目标，实际: ' + move);
    });
  });
});
