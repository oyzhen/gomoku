import { GomokuController } from "./controller";
import type { GameSnapshot } from "./types";

let session: GomokuController | null = null;

export function startGame(canvas: HTMLCanvasElement, onChange: (snapshot: GameSnapshot) => void): GomokuController {
  stopGame();
  session = new GomokuController(canvas, onChange);
  return session;
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}
