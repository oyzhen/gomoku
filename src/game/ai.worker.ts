/// <reference lib="webworker" />
import { findBestMove } from "./ai-core";
import type { Board, Player, RuleSet } from "./types";

interface AIRequest {
  board: Board;
  player: Player;
  rule: RuleSet;
  level: number;
}

self.onmessage = (event: MessageEvent<AIRequest>) => {
  const { board, player, rule, level } = event.data;
  const result = findBestMove(board, player, rule, level);
  self.postMessage(result);
};

export {};
