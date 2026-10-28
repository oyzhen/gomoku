import type { AIStats, Board, Player, Point, RuleSet } from "./types";

interface AIResponse {
  move: Point;
  stats: AIStats;
}

export class LocalAIClient {
  private worker: Worker | null = null;
  private settle: ((result: AIResponse | null) => void) | null = null;

  request(board: Board, player: Player, rule: RuleSet, level: number): Promise<AIResponse | null> {
    this.cancel();
    return new Promise((resolve) => {
      this.settle = resolve;
      this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<AIResponse | null>) => {
        const done = this.settle;
        this.clear();
        done?.(event.data);
      };
      this.worker.onerror = () => {
        const done = this.settle;
        this.clear();
        done?.(null);
      };
      this.worker.postMessage({ board: new Uint8Array(board), player, rule, level });
    });
  }

  cancel(): void {
    const done = this.settle;
    this.clear();
    done?.(null);
  }

  private clear(): void {
    this.worker?.terminate();
    this.worker = null;
    this.settle = null;
  }

  dispose(): void {
    this.cancel();
  }
}
