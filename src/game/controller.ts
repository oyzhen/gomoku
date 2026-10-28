import { LocalAIClient } from "./ai";
import { openingBalance } from "./ai-core";
import { AudioSystem } from "./audio";
import { requestLLMMove } from "./llm";
import { afterOpeningMove, applyOpeningChoice, openingActor, openingAfterUndo, type OpeningChoice, type OpeningPhase } from "./opening";
import { analyzeMove, boardFromMoves } from "./rules";
import { BoardScene } from "./scene";
import { GameStateMachine } from "./state";
import { BLACK, otherPlayer, playerName, WHITE, type GameConfig, type GameSnapshot, type Move, type Player, type Point, type ThemeId } from "./types";

export const DEFAULT_CONFIG: GameConfig = {
  mode: "ai",
  rule: "freestyle",
  level: 35,
  humanColor: BLACK,
  theme: "walnut",
  opening: "none",
  llm: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    responseFormat: "tools",
    reasoningEffort: "default",
    parameters: '{\n  "max_tokens": 4096,\n  "temperature": 0.2\n}',
  },
};

const DEMO_MOVES: Move[] = [
  { row: 7, col: 7, player: BLACK, number: 1 },
  { row: 7, col: 8, player: WHITE, number: 2 },
  { row: 8, col: 8, player: BLACK, number: 3 },
  { row: 6, col: 6, player: WHITE, number: 4 },
  { row: 8, col: 7, player: BLACK, number: 5 },
  { row: 6, col: 7, player: WHITE, number: 6 },
  { row: 9, col: 9, player: BLACK, number: 7 },
  { row: 5, col: 5, player: WHITE, number: 8 },
];

const FORBIDDEN_TEXT = {
  overline: "黑棋长连为禁手，请换一处落子",
  "double-three": "此处形成三三禁手，请换一处落子",
  "double-four": "此处形成四四禁手，请换一处落子",
  occupied: "这里已有棋子",
  outside: "请点击棋盘交叉点",
} as const;

export class GomokuController {
  private scene: BoardScene;
  private audio = new AudioSystem();
  private localAI = new LocalAIClient();
  private machine = new GameStateMachine();
  private config: GameConfig = structuredClone(DEFAULT_CONFIG);
  private moves: Move[] = [];
  private currentPlayer: Player = BLACK;
  private winner: Player | null = null;
  private winningLine: Point[] | null = null;
  private isDraw = false;
  private thinking: "local" | "llm" | null = null;
  private message = "选择对局方式，落子开局";
  private llmReason = "";
  private reviewIndex: number | null = null;
  private showForbidden = true;
  private openingPhase: OpeningPhase = null;
  private initialHumanColor: Player = BLACK;
  private searchStats: GameSnapshot["searchStats"] = null;
  private generation = 0;
  private timer = 0;
  private abort: AbortController | null = null;

  constructor(canvas: HTMLCanvasElement, private onChange: (snapshot: GameSnapshot) => void) {
    this.scene = new BoardScene(canvas, {
      onCell: (point) => this.place(point),
      canPlace: (point) => this.canPlace(point),
    });
    this.scene.setPosition(DEMO_MOVES, "freestyle", false, false);
    this.scene.setTurn(BLACK);
    if (new URLSearchParams(window.location.search).has("debug")) {
      window.__gomokuDebug = {
        snapshot: () => this.snapshot(),
        cellScreen: (row, col) => this.scene.cellScreen({ row, col }),
        place: (row, col) => this.place({ row, col }),
        metrics: () => window.__gameMetrics?.(),
      };
    }
    this.emit();
  }

  private snapshot(): GameSnapshot {
    return {
      status: this.machine.state,
      mode: this.config.mode,
      rule: this.config.rule,
      level: this.config.level,
      humanColor: this.config.humanColor,
      currentPlayer: this.currentPlayer,
      moves: [...this.moves],
      winner: this.winner,
      isDraw: this.isDraw,
      thinking: this.thinking,
      message: this.message,
      llmReason: this.llmReason,
      reviewIndex: this.reviewIndex,
      muted: this.audio.muted,
      theme: this.config.theme,
      showForbidden: this.showForbidden,
      opening: this.config.opening,
      openingPhase: this.openingPhase,
      searchStats: this.searchStats,
    };
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }

  private isMachineTurn(): boolean {
    return this.config.mode !== "local" && this.currentPlayer !== this.config.humanColor;
  }

  private canPlace(point: Point): boolean {
    if (!this.machine.is("playing") || this.thinking || this.reviewIndex !== null || this.isMachineTurn()) return false;
    if (this.openingPhase === "secondChoice" || this.openingPhase === "firstChoice") return false;
    return analyzeMove(boardFromMoves(this.moves), point.row, point.col, this.currentPlayer, this.config.rule).legal;
  }

  private syncScene(animateLatest = false): void {
    this.scene.setTurn(this.currentPlayer);
    this.scene.setPosition(this.moves, this.config.rule, this.showForbidden, animateLatest);
    this.scene.setWinningLine(this.winningLine);
    const choosing = this.openingPhase === "secondChoice" || this.openingPhase === "firstChoice";
    this.scene.setInteractive(this.machine.is("playing") && !this.thinking && !choosing && this.reviewIndex === null && !this.isMachineTurn());
  }

  start(config: GameConfig): void {
    this.cancelAsync();
    if (!this.machine.is("title")) this.machine.transition("title");
    this.config = { ...config, llm: { ...config.llm } };
    this.moves = [];
    this.currentPlayer = BLACK;
    this.initialHumanColor = config.humanColor;
    this.openingPhase = config.opening === "swap2" ? "place3" : null;
    this.winner = null;
    this.winningLine = null;
    this.isDraw = false;
    this.thinking = null;
    this.reviewIndex = null;
    this.searchStats = null;
    this.llmReason = "";
    this.message = this.openingPhase === "place3" ? "Swap2：先手依次摆放黑、白、黑三子" : "黑棋先行，静候落子";
    this.scene.setTheme(config.theme);
    this.machine.transition("playing");
    this.audio.sfx("ui");
    this.syncScene(false);
    this.emit();
    this.scheduleMachine();
  }

  place(point: Point, machineMove = false): boolean {
    if (!this.machine.is("playing") || this.reviewIndex !== null) return false;
    if (!machineMove && this.isMachineTurn()) return false;
    const analysis = analyzeMove(boardFromMoves(this.moves), point.row, point.col, this.currentPlayer, this.config.rule);
    if (!analysis.legal) {
      this.message = FORBIDDEN_TEXT[analysis.reason ?? "outside"];
      this.audio.sfx("hit");
      this.emit();
      return false;
    }
    const move: Move = { ...point, player: this.currentPlayer, number: this.moves.length + 1 };
    this.moves.push(move);
    this.message = `${playerName(move.player)}落于 ${String.fromCharCode(65 + move.col)}${move.row + 1}`;
    this.audio.sfx("move");

    if (analysis.winningLine) {
      this.winner = move.player;
      this.winningLine = analysis.winningLine;
      this.machine.transition("gameover");
      this.message = `${playerName(move.player)}五连获胜`;
      this.audio.sfx(this.config.mode === "local" || move.player === this.config.humanColor ? "win" : "lose");
    } else if (this.moves.length >= 225) {
      this.isDraw = true;
      this.machine.transition("gameover");
      this.message = "棋盘已满，本局和棋";
    } else if (this.openingPhase) {
      const next = afterOpeningMove(this.openingPhase, this.moves.length);
      this.openingPhase = next.phase;
      this.currentPlayer = next.currentPlayer;
      if (this.openingPhase === "secondChoice") this.message = "Swap2：后手请选择持白、交换，或再摆两手";
      else if (this.openingPhase === "firstChoice") this.message = "Swap2：请先手选择持黑或持白";
    } else {
      this.currentPlayer = otherPlayer(this.currentPlayer);
    }
    this.thinking = null;
    this.syncScene(true);
    this.emit();
    this.scheduleMachine();
    return true;
  }

  private scheduleMachine(): void {
    if (!this.machine.is("playing") || this.reviewIndex !== null) return;
    const actor = openingActor(this.openingPhase);
    if (actor) {
      if (this.config.mode === "local" || actor === this.config.humanColor) {
        this.thinking = null;
        this.syncScene(false);
        this.emit();
        return;
      }
      const generation = ++this.generation;
      this.thinking = this.config.mode === "llm" ? "llm" : "local";
      this.message = "AI 正在评估交换开局的黑白形势…";
      this.syncScene(false);
      this.emit();
      this.timer = window.setTimeout(() => this.runOpeningChoice(generation), 420);
      return;
    }
    if (!this.isMachineTurn()) return;
    const generation = ++this.generation;
    this.thinking = this.config.mode === "llm" ? "llm" : "local";
    this.message = this.config.mode === "llm" ? "大模型正在推演棋局…" : `本地 AI · ${this.config.level} 级思考中…`;
    this.syncScene(false);
    this.emit();
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      if (this.config.mode === "llm") void this.runLLM(generation);
      else void this.runLocalAI(generation);
    }, 280);
  }

  private runOpeningChoice(generation: number): void {
    if (generation !== this.generation || !this.machine.is("playing")) return;
    const balance = openingBalance(boardFromMoves(this.moves));
    let choice: OpeningChoice;
    if (this.openingPhase === "secondChoice") {
      if (Math.abs(balance) < 90 && this.config.level >= 65) choice = "extend";
      else choice = balance > 0 ? "black" : "white";
    } else choice = balance > 0 ? "black" : "white";
    this.thinking = null;
    this.chooseOpening(choice, true);
  }

  private async runLocalAI(generation: number): Promise<void> {
    const result = await this.localAI.request(boardFromMoves(this.moves), this.currentPlayer, this.config.rule, this.config.level);
    if (generation !== this.generation || !this.machine.is("playing")) return;
    if (!result) {
      this.thinking = null;
      this.message = "本地计算已中断，点击重试继续";
      this.emit();
      return;
    }
    this.searchStats = result.stats;
    this.thinking = null;
    this.place(result.move, true);
  }

  private async runLLM(generation: number): Promise<void> {
    this.abort = new AbortController();
    try {
      const result = await requestLLMMove(this.config.llm, boardFromMoves(this.moves), this.moves, this.currentPlayer, this.config.rule, this.abort.signal);
      if (generation !== this.generation || !this.machine.is("playing")) return;
      this.llmReason = result.reason;
      this.thinking = null;
      this.place(result.move, true);
    } catch (error) {
      if (generation !== this.generation) return;
      this.thinking = null;
      this.message = error instanceof Error ? error.message : "大模型调用失败，请重试";
      this.syncScene(false);
      this.emit();
    }
  }

  chooseOpening(choice: OpeningChoice, machineMove = false): void {
    if (!this.machine.is("playing")) return;
    const actor = openingActor(this.openingPhase);
    if (!actor || (!machineMove && this.config.mode !== "local" && actor !== this.config.humanColor)) return;
    const result = applyOpeningChoice(this.openingPhase, choice);
    if (!result) return;
    this.openingPhase = result.phase;
    this.currentPlayer = result.currentPlayer;
    if (result.swap) this.config.humanColor = otherPlayer(this.config.humanColor);
    this.thinking = null;
    this.message = this.openingPhase === "place2"
      ? "后手继续摆放白、黑两子，之后由先手选色"
      : result.swap
        ? `已交换执子，${playerName(this.currentPlayer)}继续行棋`
        : `已选择${choice === "black" ? "黑棋" : "白棋"}，白棋继续行棋`;
    this.audio.sfx("ui");
    this.syncScene(false);
    this.emit();
    this.scheduleMachine();
  }

  retry(): void {
    if (this.machine.is("playing") && !this.thinking) this.scheduleMachine();
  }

  pause(): void {
    if (!this.machine.is("playing")) return;
    this.cancelAsync();
    this.thinking = null;
    this.machine.transition("paused");
    this.message = "对局已暂停";
    this.syncScene(false);
    this.emit();
  }

  resume(): void {
    if (!this.machine.is("paused")) return;
    this.exitReview(false);
    this.machine.transition("playing");
    this.message = `${playerName(this.currentPlayer)}行棋`;
    this.syncScene(false);
    this.emit();
    this.scheduleMachine();
  }

  undo(): void {
    if (!this.moves.length || this.machine.is("title") || this.machine.is("paused")) return;
    this.cancelAsync();
    const last = this.moves[this.moves.length - 1];
    const count = this.config.mode !== "local" && last.player !== this.config.humanColor && this.moves.length > 1 ? 2 : 1;
    this.moves.splice(-count, count);
    this.currentPlayer = this.moves.length ? otherPlayer(this.moves[this.moves.length - 1].player) : BLACK;
    if (this.config.opening === "swap2") {
      this.openingPhase = openingAfterUndo(this.moves.length);
      if (this.openingPhase) this.config.humanColor = this.initialHumanColor;
    }
    this.winner = null;
    this.winningLine = null;
    this.isDraw = false;
    this.reviewIndex = null;
    this.thinking = null;
    this.llmReason = "";
    this.searchStats = null;
    if (this.machine.is("gameover")) this.machine.transition("playing");
    this.message = `已撤回 ${count} 手`;
    this.audio.sfx("ui");
    this.syncScene(false);
    this.emit();
    this.scheduleMachine();
  }

  restart(): void {
    this.config.humanColor = this.initialHumanColor;
    this.start(this.config);
  }

  resign(): void {
    if (!this.machine.is("playing")) return;
    this.cancelAsync();
    const loser = this.config.mode === "local" ? this.currentPlayer : this.config.humanColor;
    this.winner = otherPlayer(loser);
    this.winningLine = null;
    this.thinking = null;
    this.machine.transition("gameover");
    this.message = `${playerName(loser)}认输，${playerName(this.winner)}获胜`;
    this.audio.sfx(this.config.mode === "local" || this.winner === this.config.humanColor ? "win" : "lose");
    this.syncScene(false);
    this.emit();
  }

  toMenu(): void {
    this.cancelAsync();
    if (!this.machine.is("title")) this.machine.transition("title");
    this.moves = [];
    this.winner = null;
    this.winningLine = null;
    this.thinking = null;
    this.reviewIndex = null;
    this.openingPhase = null;
    this.message = "选择对局方式，落子开局";
    this.scene.setPosition(DEMO_MOVES, "freestyle", false, false);
    this.scene.setWinningLine(null);
    this.scene.setInteractive(false);
    this.emit();
  }

  review(index: number): void {
    if (this.machine.is("title") || this.machine.is("playing") && this.thinking) return;
    this.reviewIndex = Math.max(0, Math.min(this.moves.length, index));
    this.scene.setPosition(this.moves.slice(0, this.reviewIndex), this.config.rule, false, false);
    this.scene.setWinningLine(null);
    this.scene.setInteractive(false);
    this.message = `棋谱回看至第 ${this.reviewIndex} 手`;
    this.emit();
  }

  exitReview(emit = true): void {
    if (this.reviewIndex === null) return;
    this.reviewIndex = null;
    this.syncScene(false);
    this.message = this.machine.is("gameover") ? this.message : `${playerName(this.currentPlayer)}行棋`;
    if (emit) this.emit();
  }

  toggleMute(): void {
    this.audio.toggleMute();
    this.audio.sfx("ui");
    this.emit();
  }

  setTheme(theme: ThemeId): void {
    this.config.theme = theme;
    this.scene.setTheme(theme);
    this.scene.setTurn(this.currentPlayer);
    this.emit();
  }

  toggleForbidden(): void {
    this.showForbidden = !this.showForbidden;
    this.syncScene(false);
    this.emit();
  }

  resetView(top = false): void {
    if (top) this.scene.topView();
    else this.scene.resetView();
  }

  private cancelAsync(): void {
    this.generation++;
    window.clearTimeout(this.timer);
    this.localAI.cancel();
    this.abort?.abort();
    this.abort = null;
  }

  dispose(): void {
    this.cancelAsync();
    this.localAI.dispose();
    this.scene.dispose();
    this.audio.dispose();
    delete window.__gomokuDebug;
  }
}

declare global {
  interface Window {
    __gomokuDebug?: {
      snapshot: () => GameSnapshot;
      cellScreen: (row: number, col: number) => { x: number; y: number };
      place: (row: number, col: number) => boolean;
      metrics: () => unknown;
    };
  }
}
