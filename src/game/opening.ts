import { BLACK, WHITE, type Player } from "./types";

export type OpeningRule = "none" | "swap2";
export type OpeningPhase = "place3" | "secondChoice" | "place2" | "firstChoice" | null;
export type OpeningChoice = "black" | "white" | "extend";

export function afterOpeningMove(phase: OpeningPhase, moveCount: number): { phase: OpeningPhase; currentPlayer: Player } {
  if (phase === "place3") {
    if (moveCount < 3) return { phase: "place3", currentPlayer: moveCount % 2 === 0 ? BLACK : WHITE };
    return { phase: "secondChoice", currentPlayer: WHITE };
  }
  if (phase === "place2") {
    if (moveCount === 4) return { phase: "place2", currentPlayer: BLACK };
    return { phase: "firstChoice", currentPlayer: WHITE };
  }
  return { phase, currentPlayer: moveCount % 2 === 0 ? BLACK : WHITE };
}

export function openingActor(phase: OpeningPhase): Player | null {
  if (phase === "secondChoice") return WHITE;
  if (phase === "firstChoice") return BLACK;
  return null;
}

export function applyOpeningChoice(
  phase: OpeningPhase,
  choice: OpeningChoice,
): { phase: OpeningPhase; currentPlayer: Player; swap: boolean } | null {
  if (phase === "secondChoice") {
    if (choice === "extend") return { phase: "place2", currentPlayer: WHITE, swap: false };
    return { phase: null, currentPlayer: WHITE, swap: choice === "black" };
  }
  if (phase === "firstChoice" && choice !== "extend") {
    return { phase: null, currentPlayer: WHITE, swap: choice === "white" };
  }
  return null;
}

export function openingAfterUndo(moveCount: number): OpeningPhase {
  if (moveCount < 3) return "place3";
  if (moveCount === 3) return "secondChoice";
  if (moveCount === 4) return "place2";
  if (moveCount === 5) return "firstChoice";
  return null;
}
