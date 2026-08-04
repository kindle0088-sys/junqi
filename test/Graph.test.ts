import { strict as assert } from 'assert';
import { BUNKER_SQUARES, HEADQUARTER_SQUARES } from '../src/lib/BoardConstants';
import { Graph } from '../src/lib/Graph';

describe('Graph', function () {
  var graph = new Graph();

  describe('#headquarterNeighbors()', function () {
    it('headquarter nodes should keep normal cross adjacency (pieces can move out)', function () {
      // 2026-08-04 修复：大本营邻接不再清空，非地雷棋子可从大本营走出。
      // b1/d1/b12/d12 都在棋盘边缘，十字邻接各有 3 个邻居。
      const expected: { [key: string]: number } = {
        'b1': 3, 'd1': 3, 'b12': 3, 'd12': 3
      };
      HEADQUARTER_SQUARES.forEach(function(square) {
        var neighbors = graph.getAdjacentNeighbors(square);
        assert.equal(neighbors.size, expected[square], `${square} should have ${expected[square]} neighbors`);
      });
    });
  });

  describe('#graphNodeSize()', function () {
    it('graphs should only contains nodes on the board', function () {
      // each player has 30 nodes and there are 2 players
      var totalCount = 2*30;
      assert.equal(graph.nodes.length, totalCount);
      assert.equal(Object.keys(graph.neighborMap).length, totalCount);
    });
  });

  describe('#bunkerNeighborSize()', function () {
    it('bunker nodes should have 8 neighbors', function () {
      BUNKER_SQUARES.forEach(function(square) {
        var neighbors = graph.getAdjacentNeighbors(square);
        assert.equal(neighbors.size, 8);
      });
    });
  });

  describe('#bunkerNodeNeighbors()', function () {
    it("validate a single bunker node's neighbors", function () {
      var neighbors = graph.getAdjacentNeighbors("b3");
      assert.equal(neighbors.size, 8);
      assert.equal(neighbors.has("a2"), true);
      assert.equal(neighbors.has("b2"), true);
      assert.equal(neighbors.has("c2"), true);
      assert.equal(neighbors.has("a3"), true);
      assert.equal(neighbors.has("c3"), true);
      assert.equal(neighbors.has("a4"), true);
      assert.equal(neighbors.has("b4"), true);
      assert.equal(neighbors.has("c4"), true);
    });
  });

  describe('#frontNodeNeighborsConnectToOpponent()', function () {
    it("validate a single front row node that leads outside the player's territory", function () {
      var neighbors = graph.getAdjacentNeighbors("a6");
      assert.equal(neighbors.size, 4);
      assert.equal(neighbors.has("a7"), true);
      assert.equal(neighbors.has("a5"), true);
      assert.equal(neighbors.has("b6"), true);
      assert.equal(neighbors.has("b5"), true);
    });
  });

  describe('#frontNodeNeighborsDoesNotConnectToOpponent()', function () {
    it("validate a single front row node that can't access opponent's territory", function () {
      var neighbors = graph.getAdjacentNeighbors("b6");
      assert.equal(neighbors.size, 3);
      assert.equal(neighbors.has("c6"), true);
      assert.equal(neighbors.has("a6"), true);
      assert.equal(neighbors.has("b5"), true);
    });
  });

  describe('#transformSquareInvalid()', function () {
    it("Transform invalid square", function () {
      var result = graph.transformSquare("g10", {x:+0, y:+1});
      assert.equal(result, null);
    });
  });
});
