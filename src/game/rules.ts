import { BLACK, BOARD_SIZE, EMPTY, type Board, type Move, type MoveAnalysis, type Player, type Point, type RuleSet, WHITE } from "./types";

export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export const createBoard = (): Board => new Uint8Array(BOARD_SIZE * BOARD_SIZE);
export const cloneBoard = (board: Board): Board => new Uint8Array(board);
export const indexOf = (row: number, col: number): number => row * BOARD_SIZE + col;
export const inside = (row: number, col: number): boolean => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
export const cellAt = (board: Board, row: number, col: number): number => (inside(row, col) ? board[indexOf(row, col)] : -1);

export function boardFromMoves(moves: readonly Move[]): Board {
  const board = createBoard();
  for (const move of moves) board[indexOf(move.row, move.col)] = move.player;
  return board;
}

export function getRun(board: Board, row: number, col: number, player: Player, dr: number, dc: number): Point[] {
  const result: Point[] = [{ row, col }];
  let r = row - dr;
  let c = col - dc;
  while (cellAt(board, r, c) === player) {
    result.unshift({ row: r, col: c });
    r -= dr;
    c -= dc;
  }
  r = row + dr;
  c = col + dc;
  while (cellAt(board, r, c) === player) {
    result.push({ row: r, col: c });
    r += dr;
    c += dc;
  }
  return result;
}

export function getWinningLine(board: Board, row: number, col: number, player: Player, rule: RuleSet): Point[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    const run = getRun(board, row, col, player, dr, dc);
    const wins = rule === "freestyle"
      ? run.length >= 5
      : rule === "standard"
        ? run.length === 5
        : player === BLACK
          ? run.length === 5
          : run.length >= 5;
    if (wins) return run;
  }
  return null;
}

function countFours(board: Board, row: number, col: number): number {
  // An open four has two five-cell windows (and two winning ends), but it is
  // still one four. De-duplicate by the four black coordinates, not by window.
  const signatures = new Set<string>();
  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -4; offset <= 0; offset++) {
      const startRow = row + offset * dr;
      const startCol = col + offset * dc;
      let black = 0;
      let empty = 0;
      let valid = true;
      const stones: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = startRow + i * dr;
        const c = startCol + i * dc;
        if (!inside(r, c)) {
          valid = false;
          break;
        }
        const cell = cellAt(board, r, c);
        if (cell === BLACK) {
          black++;
          stones.push(indexOf(r, c));
        } else if (cell === EMPTY) empty++;
      }
      if (valid && black === 4 && empty === 1) signatures.add(stones.join(","));
    }
  }
  return signatures.size;
}

function makesStraightFour(board: Board, row: number, col: number, originRow: number, originCol: number, dr: number, dc: number): boolean {
  for (let offset = -3; offset <= 0; offset++) {
    const startRow = row + offset * dr;
    const startCol = col + offset * dc;
    const endRow = startRow + 3 * dr;
    const endCol = startCol + 3 * dc;
    const beforeRow = startRow - dr;
    const beforeCol = startCol - dc;
    const afterRow = endRow + dr;
    const afterCol = endCol + dc;
    if (!inside(beforeRow, beforeCol) || !inside(afterRow, afterCol)) continue;
    if (cellAt(board, beforeRow, beforeCol) !== EMPTY || cellAt(board, afterRow, afterCol) !== EMPTY) continue;
    let includesOrigin = false;
    let valid = true;
    for (let i = 0; i < 4; i++) {
      const r = startRow + i * dr;
      const c = startCol + i * dc;
      if (cellAt(board, r, c) !== BLACK) {
        valid = false;
        break;
      }
      if (r === originRow && c === originCol) includesOrigin = true;
    }
    if (valid && includesOrigin) return true;
  }
  return false;
}

function isTrueThree(board: Board, originRow: number, originCol: number, dr: number, dc: number, depth: number): boolean {
  for (let offset = -4; offset <= 4; offset++) {
    if (offset === 0) continue;
    const row = originRow + offset * dr;
    const col = originCol + offset * dc;
    if (!inside(row, col) || cellAt(board, row, col) !== EMPTY) continue;
    const index = indexOf(row, col);
    board[index] = BLACK;
    const straightFour = makesStraightFour(board, row, col, originRow, originCol, dr, dc);
    board[index] = EMPTY;
    if (!straightFour) continue;
    if (depth >= 7 || forbiddenReason(board, row, col, BLACK, "renju", depth + 1) === null) return true;
  }
  return false;
}

/** Returns null for a legal move. The board is restored before returning. */
export function forbiddenReason(
  board: Board,
  row: number,
  col: number,
  player: Player,
  rule: RuleSet,
  depth = 0,
): "overline" | "double-three" | "double-four" | null {
  if (rule !== "renju" || player !== BLACK || !inside(row, col) || cellAt(board, row, col) !== EMPTY) return null;
  const index = indexOf(row, col);
  board[index] = BLACK;

  // An exact five takes priority over every other shape made by the same move.
  if (getWinningLine(board, row, col, BLACK, rule)) {
    board[index] = EMPTY;
    return null;
  }

  let result: "overline" | "double-three" | "double-four" | null = null;
  for (const [dr, dc] of DIRECTIONS) {
    if (getRun(board, row, col, BLACK, dr, dc).length >= 6) {
      result = "overline";
      break;
    }
  }
  if (!result && countFours(board, row, col) >= 2) result = "double-four";
  if (!result) {
    let threes = 0;
    for (const [dr, dc] of DIRECTIONS) {
      if (isTrueThree(board, row, col, dr, dc, depth)) threes++;
    }
    if (threes >= 2) result = "double-three";
  }
  board[index] = EMPTY;
  return result;
}

export function analyzeMove(board: Board, row: number, col: number, player: Player, rule: RuleSet): MoveAnalysis {
  if (!inside(row, col)) return { legal: false, reason: "outside" };
  if (cellAt(board, row, col) !== EMPTY) return { legal: false, reason: "occupied" };
  const reason = forbiddenReason(board, row, col, player, rule);
  if (reason) return { legal: false, reason };
  const index = indexOf(row, col);
  board[index] = player;
  const winningLine = getWinningLine(board, row, col, player, rule) ?? undefined;
  board[index] = EMPTY;
  return { legal: true, winningLine };
}

export function legalMoves(board: Board, player: Player, rule: RuleSet): Point[] {
  const moves: Point[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (cellAt(board, row, col) === EMPTY && !forbiddenReason(board, row, col, player, rule)) moves.push({ row, col });
    }
  }
  return moves;
}

export function boardToText(board: Board): string {
  const header = "   " + Array.from({ length: BOARD_SIZE }, (_, col) => String.fromCharCode(65 + col)).join(" ");
  const rows = [header];
  for (let row = 0; row < BOARD_SIZE; row++) {
    let line = String(row + 1).padStart(2, " ") + " ";
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = cellAt(board, row, col);
      line += ` ${cell === BLACK ? "X" : cell === WHITE ? "O" : "."}`;
    }
    rows.push(line);
  }
  return rows.join("\n");
}
