import { describe, expect, it } from "vitest";
import { findBestMove, getAIProfile } from "./ai-core";
import { createBoard, indexOf } from "./rules";
import { BLACK, WHITE } from "./types";

describe("100-level local AI", () => {
  it("maps the full level range to monotonic thinking budgets", () => {
    expect(getAIProfile(1).depth).toBe(1);
    expect(getAIProfile(100).depth).toBe(4);
    expect(getAIProfile(100).timeMs).toBeGreaterThan(getAIProfile(50).timeMs);
    expect(getAIProfile(1).randomness).toBeGreaterThan(getAIProfile(99).randomness);
    expect(getAIProfile(100).randomness).toBe(0);
  });

  it("takes an immediate win", () => {
    const board = createBoard();
    for (const col of [4, 5, 6, 7]) board[indexOf(7, col)] = BLACK;
    const result = findBestMove(board, BLACK, "freestyle", 60);
    expect([{ row: 7, col: 3 }, { row: 7, col: 8 }]).toContainEqual(result?.move);
  });

  it("blocks an immediate loss at a serious level", () => {
    const board = createBoard();
    for (const col of [4, 5, 6, 7]) board[indexOf(7, col)] = WHITE;
    board[indexOf(6, 6)] = BLACK;
    const result = findBestMove(board, BLACK, "freestyle", 80);
    expect([{ row: 7, col: 3 }, { row: 7, col: 8 }]).toContainEqual(result?.move);
  });
});
