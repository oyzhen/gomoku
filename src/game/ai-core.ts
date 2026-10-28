import { analyzeMove, cellAt, cloneBoard, createBoard, DIRECTIONS, forbiddenReason, getRun, indexOf, inside } from "./rules";
import { BLACK, BOARD_SIZE, EMPTY, otherPlayer, type AIStats, type Board, type Player, type Point, type RuleSet } from "./types";

const WIN = 10_000_000;
const SEARCH_TIMEOUT = Symbol("search-timeout");

export interface AIProfile {
  depth: number;
  timeMs: number;
  candidates: number;
  randomness: number;
  label: string;
}

export interface AIMoveResult {
  move: Point;
  stats: AIStats;
}

interface ScoredPoint extends Point {
  score: number;
}

export function getAIProfile(level: number): AIProfile {
  const safeLevel = Math.max(1, Math.min(100, Math.round(level)));
  const t = (safeLevel - 1) / 99;
  const depth = safeLevel < 15 ? 1 : safeLevel < 45 ? 2 : safeLevel < 88 ? 3 : 4;
  return {
    depth,
    timeMs: Math.round(35 + 1245 * Math.pow(t, 1.6)),
    candidates: Math.round(6 + 8 * t),
    randomness: Math.pow(1 - t, 1.7),
    label: safeLevel <= 10 ? "入门" : safeLevel <= 30 ? "进阶" : safeLevel <= 60 ? "熟练" : safeLevel <= 85 ? "高手" : safeLevel <= 97 ? "大师" : "巅峰",
  };
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boardSeed(board: Board, player: Player, level: number): number {
  let seed = 2166136261 ^ player ^ level;
  for (let i = 0; i < board.length; i++) seed = Math.imul(seed ^ board[i], 16777619);
  return seed >>> 0;
}

const WINDOWS: number[][] = [];
for (const [dr, dc] of DIRECTIONS) {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const endRow = row + 4 * dr;
      const endCol = col + 4 * dc;
      if (!inside(endRow, endCol)) continue;
      const window: number[] = [];
      for (let i = 0; i < 5; i++) window.push(indexOf(row + i * dr, col + i * dc));
      WINDOWS.push(window);
    }
  }
}
const WINDOW_SCORE = [0, 2, 22, 220, 3200, 120000];

function evaluate(board: Board, perspective: Player): number {
  const opponent = otherPlayer(perspective);
  let own = 0;
  let rival = 0;
  for (const window of WINDOWS) {
    let ownCount = 0;
    let rivalCount = 0;
    for (const index of window) {
      if (board[index] === perspective) ownCount++;
      else if (board[index] === opponent) rivalCount++;
    }
    if (rivalCount === 0) own += WINDOW_SCORE[ownCount];
    else if (ownCount === 0) rival += WINDOW_SCORE[rivalCount];
  }
  return own - rival * 1.08;
}

function localShapeScore(board: Board, row: number, col: number, player: Player): number {
  const opponent = otherPlayer(player);
  let score = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const run = getRun(board, row, col, player, dr, dc);
    const first = run[0];
    const last = run[run.length - 1];
    const openA = cellAt(board, first.row - dr, first.col - dc) === EMPTY ? 1 : 0;
    const openB = cellAt(board, last.row + dr, last.col + dc) === EMPTY ? 1 : 0;
    const open = openA + openB;
    const length = run.length;
    if (length >= 5) score += WIN;
    else if (length === 4) score += open === 2 ? 600000 : open === 1 ? 65000 : 0;
    else if (length === 3) score += open === 2 ? 52000 : open === 1 ? 4200 : 0;
    else if (length === 2) score += open === 2 ? 1400 : open === 1 ? 140 : 0;
    else score += open * 12;

    for (let offset = -4; offset <= 0; offset++) {
      let own = 0;
      let valid = true;
      for (let i = 0; i < 5; i++) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;
        if (!inside(r, c) || cellAt(board, r, c) === opponent) {
          valid = false;
          break;
        }
        if (cellAt(board, r, c) === player) own++;
      }
      if (valid) score += WINDOW_SCORE[own] * 0.45;
    }
  }
  return score;
}

function moveScore(board: Board, row: number, col: number, player: Player, rule: RuleSet): number {
  const ownAnalysis = analyzeMove(board, row, col, player, rule);
  if (!ownAnalysis.legal) return -Infinity;
  if (ownAnalysis.winningLine) return WIN * 2;
  const opponent = otherPlayer(player);
  const index = indexOf(row, col);
  board[index] = player;
  const attack = localShapeScore(board, row, col, player);
  board[index] = EMPTY;
  let defense = 0;
  const rivalAnalysis = analyzeMove(board, row, col, opponent, rule);
  if (rivalAnalysis.winningLine) defense = WIN * 1.8;
  else if (rivalAnalysis.legal) {
    board[index] = opponent;
    defense = localShapeScore(board, row, col, opponent);
    board[index] = EMPTY;
  }
  const center = 7 - (Math.abs(row - 7) + Math.abs(col - 7)) * 0.08;
  return attack + defense * 0.94 + center;
}

function generateCandidates(board: Board, player: Player, rule: RuleSet, limit: number): ScoredPoint[] {
  let stones = 0;
  for (const cell of board) if (cell !== EMPTY) stones++;
  if (stones === 0) return board[indexOf(7, 7)] === EMPTY ? [{ row: 7, col: 7, score: 1 }] : [];

  const marked = new Uint8Array(board.length);
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (cellAt(board, row, col) === EMPTY) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (inside(r, c) && cellAt(board, r, c) === EMPTY) marked[indexOf(r, c)] = 1;
        }
      }
    }
  }
  const candidates: ScoredPoint[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!marked[indexOf(row, col)]) continue;
      const score = moveScore(board, row, col, player, rule);
      if (Number.isFinite(score)) candidates.push({ row, col, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

function negamax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  player: Player,
  rule: RuleSet,
  profile: AIProfile,
  context: { nodes: number; deadline: number },
): number {
  context.nodes++;
  if ((context.nodes & 63) === 0 && performance.now() > context.deadline) throw SEARCH_TIMEOUT;
  const candidates = generateCandidates(board, player, rule, profile.candidates);
  if (candidates.length === 0) return 0;
  if (candidates[0].score >= WIN * 2) return WIN + depth;
  if (depth <= 0) return evaluate(board, player);

  let best = -Infinity;
  for (const candidate of candidates) {
    const index = indexOf(candidate.row, candidate.col);
    board[index] = player;
    const score = -negamax(board, depth - 1, -beta, -alpha, otherPlayer(player), rule, profile, context);
    board[index] = EMPTY;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove(source: Board, player: Player, rule: RuleSet, level: number): AIMoveResult | null {
  const started = performance.now();
  const board = cloneBoard(source);
  const profile = getAIProfile(level);
  const rng = mulberry32(boardSeed(board, player, level));
  const context = { nodes: 0, deadline: started + profile.timeMs };
  const roots = generateCandidates(board, player, rule, Math.max(profile.candidates, 12));
  if (roots.length === 0) return null;

  // Even the beginner level can see a direct five. Deliberate fallibility is
  // reserved for positional judgement and, at low levels, some defensive reads.
  if (roots[0].score >= WIN * 2) {
    return { move: { row: roots[0].row, col: roots[0].col }, stats: { nodes: 1, elapsed: performance.now() - started, depth: 0 } };
  }

  let bestMove: Point = { row: roots[0].row, col: roots[0].col };
  let completedDepth = 0;
  let ordered = roots;
  try {
    for (let depth = 1; depth <= profile.depth; depth++) {
      let bestScore = -Infinity;
      let depthMove = bestMove;
      const nextOrder: ScoredPoint[] = [];
      for (const candidate of ordered) {
        if (performance.now() > context.deadline) throw SEARCH_TIMEOUT;
        const index = indexOf(candidate.row, candidate.col);
        board[index] = player;
        const score = -negamax(board, depth - 1, -Infinity, Infinity, otherPlayer(player), rule, profile, context);
        board[index] = EMPTY;
        nextOrder.push({ ...candidate, score });
        if (score > bestScore) {
          bestScore = score;
          depthMove = { row: candidate.row, col: candidate.col };
        }
      }
      bestMove = depthMove;
      completedDepth = depth;
      ordered = nextOrder.sort((a, b) => b.score - a.score);
    }
  } catch (error) {
    if (error !== SEARCH_TIMEOUT) throw error;
  }

  if (profile.randomness > 0.02 && completedDepth <= 1) {
    const poolSize = Math.min(ordered.length, 2 + Math.ceil(profile.randomness * 8));
    const mustBlock = ordered[0].score > WIN;
    if (!mustBlock || rng() > profile.randomness * 0.72) {
      const pick = Math.min(poolSize - 1, Math.floor(Math.pow(rng(), 1.7) * poolSize));
      bestMove = { row: ordered[pick].row, col: ordered[pick].col };
    }
  }

  return {
    move: bestMove,
    stats: { nodes: context.nodes, elapsed: Math.round(performance.now() - started), depth: completedDepth },
  };
}

export function openingBalance(board: Board): number {
  return evaluate(board, BLACK);
}

export function findAnyLegalMove(source: Board, player: Player, rule: RuleSet): Point | null {
  const board = cloneBoard(source);
  if (board.every((cell) => cell === EMPTY) && !forbiddenReason(board, 7, 7, player, rule)) return { row: 7, col: 7 };
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (analyzeMove(board, row, col, player, rule).legal) return { row, col };
    }
  }
  return null;
}

export const emptyAIBoard = (): Board => createBoard();
export const blackFirst = BLACK;
