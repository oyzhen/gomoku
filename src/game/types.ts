export const BOARD_SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Player = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Player;
export type Board = Uint8Array;
export type RuleSet = "freestyle" | "standard" | "renju";
export type GameMode = "ai" | "local" | "llm";
export type GameStatus = "title" | "playing" | "paused" | "gameover";
export type ThemeId = "walnut" | "ink" | "celadon" | "cosmic";
export type { OpeningChoice, OpeningPhase, OpeningRule } from "./opening";

export interface Point {
  row: number;
  col: number;
}

export interface Move extends Point {
  player: Player;
  number: number;
}

export interface LLMSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Structured tool calling by default; JSON is the compatibility fallback. */
  responseFormat: "tools" | "json";
  /** Optional reasoning effort. "default" does not send a reasoning_effort field. */
  reasoningEffort: "default" | "low" | "medium" | "high";
  /** Local request timeout in seconds; this is not sent to the provider. */
  timeoutSeconds: number;
  /** OpenAI-compatible request parameters as editable JSON. Null removes a field. */
  parameters: string;
}

export interface GameConfig {
  mode: GameMode;
  rule: RuleSet;
  level: number;
  humanColor: Player;
  theme: ThemeId;
  opening: import("./opening").OpeningRule;
  llm: LLMSettings;
}

export interface GameSnapshot {
  status: GameStatus;
  mode: GameMode;
  rule: RuleSet;
  level: number;
  humanColor: Player;
  currentPlayer: Player;
  moves: Move[];
  winner: Player | null;
  isDraw: boolean;
  thinking: "local" | "llm" | null;
  message: string;
  llmReason: string;
  reviewIndex: number | null;
  muted: boolean;
  theme: ThemeId;
  showForbidden: boolean;
  opening: import("./opening").OpeningRule;
  openingPhase: import("./opening").OpeningPhase;
  searchStats: { nodes: number; elapsed: number; depth: number } | null;
}

export interface MoveAnalysis {
  legal: boolean;
  reason?: "overline" | "double-three" | "double-four" | "occupied" | "outside";
  winningLine?: Point[];
}

export interface AIStats {
  nodes: number;
  elapsed: number;
  depth: number;
}

export const otherPlayer = (player: Player): Player => (player === BLACK ? WHITE : BLACK);
export const playerName = (player: Player): string => `${player === BLACK ? "黑棋" : "白棋"}`;
export const coordinateName = ({ row, col }: Point): string => `${String.fromCharCode(65 + col)}${row + 1}`;
