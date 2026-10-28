import { describe, expect, it } from "vitest";
import { analyzeMove, boardToText, createBoard, forbiddenReason, indexOf, legalMoves } from "./rules";
import { BLACK, WHITE, type Point } from "./types";

function position(black: Point[], white: Point[] = []) {
  const board = createBoard();
  for (const { row, col } of black) board[indexOf(row, col)] = BLACK;
  for (const { row, col } of white) board[indexOf(row, col)] = WHITE;
  return board;
}

describe("winning rules", () => {
  const black = [3, 4, 5, 6].map((col) => ({ row: 7, col }));

  it("freestyle accepts five and overline", () => {
    const board = position(black);
    expect(analyzeMove(board, 7, 7, BLACK, "freestyle").winningLine).toHaveLength(5);
    board[indexOf(7, 8)] = BLACK;
    expect(analyzeMove(board, 7, 7, BLACK, "freestyle").winningLine).toHaveLength(6);
  });

  it("standard requires exactly five", () => {
    const board = position([...black, { row: 7, col: 8 }]);
    expect(analyzeMove(board, 7, 7, BLACK, "standard").winningLine).toBeUndefined();
    expect(analyzeMove(board, 7, 7, BLACK, "standard").legal).toBe(true);
  });

  it("renju treats black overline as forbidden but white overline as a win", () => {
    const blackBoard = position([...black, { row: 7, col: 8 }]);
    expect(forbiddenReason(blackBoard, 7, 7, BLACK, "renju")).toBe("overline");
    const whiteBoard = position([], [...black, { row: 7, col: 8 }]);
    expect(analyzeMove(whiteBoard, 7, 7, WHITE, "renju").winningLine).toHaveLength(6);
  });
});

describe("renju forbidden moves", () => {
  it("detects a cross double-three", () => {
    const board = position([
      { row: 7, col: 6 }, { row: 7, col: 8 },
      { row: 6, col: 7 }, { row: 8, col: 7 },
    ]);
    expect(forbiddenReason(board, 7, 7, BLACK, "renju")).toBe("double-three");
  });

  it("detects double-four", () => {
    const board = position([
      { row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 8 },
      { row: 5, col: 7 }, { row: 6, col: 7 }, { row: 8, col: 7 },
    ]);
    expect(forbiddenReason(board, 7, 7, BLACK, "renju")).toBe("double-four");
  });

  it("allows four-three", () => {
    const board = position([
      { row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 8 },
      { row: 6, col: 7 }, { row: 8, col: 7 },
    ]);
    expect(forbiddenReason(board, 7, 7, BLACK, "renju")).toBeNull();
  });

  it("does not count a blocked three", () => {
    const board = position(
      [{ row: 7, col: 6 }, { row: 7, col: 8 }, { row: 6, col: 7 }, { row: 8, col: 7 }],
      [{ row: 5, col: 7 }],
    );
    expect(forbiddenReason(board, 7, 7, BLACK, "renju")).toBeNull();
  });

  it("never restricts white", () => {
    const board = position([], [
      { row: 7, col: 6 }, { row: 7, col: 8 },
      { row: 6, col: 7 }, { row: 8, col: 7 },
    ]);
    expect(forbiddenReason(board, 7, 7, WHITE, "renju")).toBeNull();
  });

  it("occupied points are not legal", () => {
    const board = position([{ row: 7, col: 7 }]);
    expect(analyzeMove(board, 7, 7, BLACK, "freestyle").reason).toBe("occupied");
    expect(legalMoves(board, BLACK, "freestyle")).toHaveLength(224);
  });

  it("serializes a readable coordinate board", () => {
    const board = position([{ row: 0, col: 0 }]);
    expect(boardToText(board)).toContain("X");
    expect(boardToText(board)).toContain("A B C");
  });
});
