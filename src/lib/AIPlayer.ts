import { Game } from './Game';
import { PlayerMove } from './Board';
import { PieceRank } from './Piece';
import { BUNKER_SQUARES, HEADQUARTER_SQUARES } from './BoardConstants';

/**
 * 智能 AI 对手 —— 启发式策略 + 有限信息记忆
 *
 * 公平性设计（AI 与人类玩家同信息量，不读取隐藏棋盘）：
 * - 只消费 board.getMovesForPlayer() 的合法着法（服务端权威计算）
 * - 不知道对方棋子 rank，但通过自己的攻击结果维护记忆：
 *   capture → 对方比我弱；dies → 对方比我强；equal → 同归于尽
 * - 攻击前先记录自己的强度，走子后根据 lastMove 结果更新知识
 *
 * 策略要点：
 * 1. 工兵：沿铁路冲向对方后场（挖地雷、摸军旗）——军棋胜负手
 * 2. 攻击：只吃"确定能赢"的软柿子；司令/军长/师长不盲攻未知目标
 * 3. 低价值棋子：主动推进试探，牺牲可接受
 * 4. 防守：高价值棋子留守己方半场，炸弹留在防线威慑
 * 5. 记忆：攻击后更新对方强度认知
 */

interface KnowledgeEntry {
  maxRank: number; // 对方该位置棋子 rank ≤ maxRank（数值小=强，如司令=1）
  known: boolean;
}

interface PendingAttack {
  moveString: string;
  startSquare: string;
  endSquare: string;
  myRank: number;
}

export class AIPlayer {
  private knowledge: { [square: string]: KnowledgeEntry } = {};
  private aiColor: string;
  private enemyColor: string;
  private pendingAttack: PendingAttack | null = null;
  private lastAIStartSquare: string | null = null;

  constructor(aiColor: string) {
    this.aiColor = aiColor;
    this.enemyColor = aiColor === 'blue' ? 'red' : 'blue';
  }

  /**
   * 根据当前局面选择一步。
   * @returns moveString（如 "a6 - a5" / "a6 x a7"），无合法着法返回 null
   */
  chooseMove(game: Game): string | null {
    const moves = game.board.getMovesForPlayer(this.aiColor);
    if (!moves || moves.length === 0) return null;

    this.updateKnowledgeFromLastMove(game);

    // 1. 必胜攻击（记忆里确定能赢的目标）
    const winningAttack = this.findWinningAttack(game, moves);
    if (winningAttack) {
      this.recordPendingAttack(game, winningAttack);
      this.lastAIStartSquare = winningAttack.startSquare;
      return this.toMoveString(winningAttack);
    }

    // 2. 工兵冲锋（仅攻击场景特殊优先：挖雷/摸旗）
    //    工兵普通移动不单独优先，走统一打分，避免被围棋子反复踱步
    const engineerAttack = this.findEngineerAttack(game, moves);
    if (engineerAttack) {
      this.recordPendingAttack(game, engineerAttack);
      this.lastAIStartSquare = engineerAttack.startSquare;
      return this.toMoveString(engineerAttack);
    }

    // 3. 启发式打分选最佳
    const best = this.scoreBestMove(game, moves);
    this.recordPendingAttack(game, best);
    this.lastAIStartSquare = best.startSquare;
    return this.toMoveString(best);
  }

  /** 攻击前记录自己的强度（走子后棋子可能消失，无法反推） */
  private recordPendingAttack(game: Game, move: PlayerMove): void {
    if (move.type !== 'attack') {
      this.pendingAttack = null;
      return;
    }
    const myPiece = game.board.getPieceAtSquare(move.startSquare);
    if (!myPiece) {
      this.pendingAttack = null;
      return;
    }
    this.pendingAttack = {
      moveString: this.toMoveString(move),
      startSquare: move.startSquare,
      endSquare: move.endSquare,
      myRank: myPiece.getRank()
    };
  }

  /** 从上一手攻击结果更新记忆 */
  private updateKnowledgeFromLastMove(game: Game): void {
    const last = game.lastMove;
    const pending = this.pendingAttack;
    if (!last || !pending) return;
    // 确认上一手确实是我们的攻击（防止其他人走了别的棋）
    if (last.type !== 'capture' && last.type !== 'dies' && last.type !== 'equal') return;
    if (last.endSquare !== pending.endSquare) return;

    const target = pending.endSquare;
    const myRank = pending.myRank;

    if (last.type === 'dies') {
      // 我输了：对方 rank < 我的 rank（数值小=强），对方仍在目标位置
      // 记下"该位置有比我试探子更强的棋子"，下次派更强的主力去收
      this.knowledge[target] = { maxRank: myRank - 1, known: true };
    } else {
      // capture（对方被吃）/ equal（同归于尽）：目标位置已无对方棋子，遗忘
      delete this.knowledge[target];
    }
    this.pendingAttack = null;
  }

  /** 找确定能赢的攻击 */
  private findWinningAttack(game: Game, moves: PlayerMove[]): PlayerMove | null {
    const attacks = moves.filter(m => m.type === 'attack');
    if (attacks.length === 0) return null;

    for (const m of attacks) {
      const myPiece = game.board.getPieceAtSquare(m.startSquare);
      if (!myPiece) continue;
      const myRank = myPiece.getRank();

      // 记忆：对方曾被我弱子试探出 maxRank（数值小=强），
      // 若我当前棋子比它强（myRank < maxRank，数值更小），则确定能赢
      const known = this.knowledge[m.endSquare];
      if (known && known.known && myRank < known.maxRank) {
        return m;
      }

      // 工兵挖雷：对方最后两排/大本营的棋子大概率是地雷，工兵必胜
      if (myRank === PieceRank.ENGINEER && this.isLikelyLandmine(m.endSquare)) {
        return m;
      }
    }
    return null;
  }

  /** 是否大概率是地雷位置（对方最后两排 或 大本营） */
  private isLikelyLandmine(square: string): boolean {
    const row = parseInt(square.slice(1), 10);
    const enemyBack = (this.enemyColor === 'blue') ? (row <= 2) : (row >= 11);
    return enemyBack || HEADQUARTER_SQUARES.includes(square);
  }

  /** 工兵攻击策略：只处理挖雷/摸旗等攻击场景（工兵独有能力，特殊优先） */
  private findEngineerAttack(game: Game, moves: PlayerMove[]): PlayerMove | null {
    const engineerAttacks = moves.filter(m => {
      const p = game.board.getPieceAtSquare(m.startSquare);
      return m.type === 'attack' && p && p.getRank() === PieceRank.ENGINEER;
    });
    if (engineerAttacks.length === 0) return null;

    // 选最深入对方后场的攻击目标（最有可能是雷/旗）
    return engineerAttacks.sort((a, b) => this.enemyDepth(b.endSquare) - this.enemyDepth(a.endSquare))[0];
  }

  /** 格子深入对方阵营的程度（越大越深入对方后场） */
  private enemyDepth(square: string): number {
    const row = parseInt(square.slice(1), 10);
    if (this.enemyColor === 'blue') {
      return 13 - row; // row=1 最深入（对方大本营）
    }
    return row; // row=12 最深入
  }

  /** 启发式打分选最佳着法 */
  private scoreBestMove(game: Game, moves: PlayerMove[]): PlayerMove {
    let best = moves[0];
    let bestScore = -Infinity;

    for (const m of moves) {
      const myPiece = game.board.getPieceAtSquare(m.startSquare);
      if (!myPiece) continue;
      const rank = myPiece.getRank();

      const score = (m.type === 'attack')
        ? this.scoreAttack(game, m, rank)
        : this.scoreMove(game, m, rank);

      // 上一手刚动过的棋子：降权，避免同一枚棋子反复踱步（如行营里来回走）
      let adjusted = score;
      if (m.startSquare === this.lastAIStartSquare) {
        adjusted -= 25;
      }

      // 少量随机抖动，避免 AI 每局一模一样
      const randomized = adjusted + Math.random() * 2;

      if (randomized > bestScore) {
        bestScore = randomized;
        best = m;
      }
    }
    return best;
  }

  private scoreAttack(game: Game, m: PlayerMove, myRank: number): number {
    let score = 30;
    const targetSquare = m.endSquare;

    // 记忆：确定能赢 +60
    const known = this.knowledge[targetSquare];
    if (known && known.known && myRank < known.maxRank) score += 60;

    // 高价值棋子（司令~旅长）：不盲攻未知目标，可能撞雷/炸弹/高等级
    if (myRank <= PieceRank.BRIGADIER_GENERAL) {
      if (!(known && known.known)) score -= 40;
    } else {
      // 低价值棋子（团长及以下）：试探性攻击可接受
      score += 10;
    }

    // 目标是对方大本营（很可能是军旗）：高优先级
    if (HEADQUARTER_SQUARES.includes(targetSquare)) score += 40;

    // 炸弹：攻击 = 同归于尽，仅用于对方强子深入我方半场时
    if (myRank === PieceRank.BOMB) {
      score = -20;
      if (this.enemyDepth(targetSquare) < 5) score += 50; // 对方棋子压到我方家门口才炸
    }

    return score;
  }

  private scoreMove(game: Game, m: PlayerMove, myRank: number): number {
    let score = 0;
    const dest = m.endSquare;
    const src = m.startSquare;
    const srcInBunker = BUNKER_SQUARES.includes(src);
    const destInBunker = BUNKER_SQUARES.includes(dest);

    // 行营是安全区：从非行营进入行营才加分；
    // 行营内/行营间移动不加分（避免 AI 在行营链里打转）
    if (destInBunker && !srcInBunker) score += 12;

    // 回到上一格（原地打转）：降分
    if (game.lastMove && game.lastMove.endSquare === src && game.lastMove.startSquare === dest) {
      score -= 20;
    }

    // 向对方半场推进
    const progress = this.enemyDepth(dest) - this.enemyDepth(src);
    score += progress * 3;

    // 工兵移动：冲向对方后场（工兵是进攻棋子，不进行营躲藏）
    if (myRank === PieceRank.ENGINEER) {
      score += this.enemyDepth(dest) * 2 + 10;
      if (destInBunker) score -= 15; // 工兵进行营是浪费进攻力
    }

    // 司令/军长防守：不越过中线送死
    if (myRank <= PieceRank.MAJOR_GENERAL) {
      if (this.isBeyondMiddle(dest)) score -= 30;
      score += 15;
    }

    // 炸弹：尽量不动，除非能进入行营
    if (myRank === PieceRank.BOMB) {
      score = -25;
      if (destInBunker && !srcInBunker) score += 10;
    }

    return score;
  }

  /** 是否越过中线（进入对方半场） */
  private isBeyondMiddle(square: string): boolean {
    const row = parseInt(square.slice(1), 10);
    if (this.enemyColor === 'blue') return row < 6;
    return row > 7;
  }

  private toMoveString(m: PlayerMove): string {
    const symbol = m.type === 'attack' ? 'x' : '-';
    return `${m.startSquare} ${symbol} ${m.endSquare}`;
  }
}
