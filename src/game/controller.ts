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
    timeoutSeconds: 120,
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
      moves: this.moves.map((move) => ({ ...move })),
      winner: this.winner,
      isDraw: this.isDraw,
      thinking: this.thinking,
      message: this.message,
      llmReason: this.llmReason,
      reviewIndex: this.reviewIndex,
      muted: this.audio.muted,
      theme: this.scene.theme,
      showForbidden: this.showForbidden,
      opening: this.config.opening,
      openingPhase: this.openingPhase,
      searchStats: this.searchStats,
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }

  setTheme(theme: ThemeId) {
    this.scene.setTheme(theme);
    this.emit();
  }

  start(config: GameConfig) {
    this.cancelPending();
    this.config = structuredClone(config);
    this.initialHumanColor = config.humanColor;
    this.moves = [];
    this.currentPlayer = BLACK;
    this.winner = null;
    this.winningLine = null;
    this.isDraw = false;
    this.thinking = null;
    this.llmReason = "";
    this.reviewIndex = null;
    this.openingPhase = config.opening === "swap2" ? "place3" : null;
    this.searchStats = null;
    this.message = this.openingPhase ? "交换开局：先手请摆放黑、白、黑三子" : "黑棋先行，点击交叉点落子";
    this.machine.start();
    this.scene.setPosition([], config.rule, this.showForbidden, false);
    this.scene.setTheme(config.theme);
    this.scene.setTurn(BLACK);
    this.audio.start();
    this.emit();
    this.scheduleMachine();
  }

  restart() {
    this.start(this.config);
  }

  toMenu() {
    this.cancelPending();
    this.machine.menu();
    this.thinking = null;
    this.reviewIndex = null;
    this.message = "选择对局方式，落子开局";
    this.scene.setPosition(DEMO_MOVES, "freestyle", false, false);
    this.scene.setTurn(BLACK);
    this.emit();
  }

  pause() {
    if (!this.machine.pause()) return;
    window.clearTimeout(this.timer);
    this.emit();
  }

  resume() {
    if (!this.machine.resume()) return;
    this.emit();
    this.scheduleMachine();
  }

  toggleMute() {
    this.audio.toggle();
    this.emit();
  }

  toggleForbidden() {
    this.showForbidden = !this.showForbidden;
    this.refreshBoard();
    this.emit();
  }

  resetView(top = false) {
    this.scene.resetView(top);
  }

  resign() {
    if (this.machine.state !== "playing" || this.reviewIndex !== null) return;
    this.cancelPending();
    this.winner = otherPlayer(this.currentPlayer);
    this.message = `${playerName(this.currentPlayer)}认输，${playerName(this.winner)}获胜`;
    this.machine.finish();
    this.audio.play("win");
    this.emit();
  }

  undo() {
    if (!this.moves.length || this.machine.state === "title") return;
    this.cancelPending();
    if (this.machine.state === "gameover") this.machine.resume();
    this.reviewIndex = null;
    this.winner = null;
    this.winningLine = null;
    this.isDraw = false;
    this.llmReason = "";
    let count = 1;
    if (this.config.mode !== "local" && !this.openingPhase) {
      const last = this.moves[this.moves.length - 1];
      count = last.player === this.config.humanColor ? 1 : Math.min(2, this.moves.length);
    }
    for (let i = 0; i < count; i++) {
      this.moves.pop();
      this.openingPhase = openingAfterUndo(this.config.opening, this.moves.length, this.openingPhase);
    }
    this.currentPlayer = this.moves.length % 2 === 0 ? BLACK : WHITE;
    this.thinking = null;
    this.message = "已悔棋，请重新落子";
    this.refreshBoard();
    this.emit();
    this.scheduleMachine();
  }

  review(number: number) {
    this.reviewIndex = Math.max(1, Math.min(number, this.moves.length));
    this.refreshBoard();
    this.emit();
  }

  exitReview() {
    this.reviewIndex = null;
    this.refreshBoard();
    this.emit();
  }

  retry() {
    if (this.machine.state !== "playing" || this.thinking) return;
    this.message = "正在重新请求大模型…";
    this.emit();
    this.scheduleMachine(true);
  }

  chooseOpening(choice: OpeningChoice) {
    if (!this.openingPhase || this.thinking || this.reviewIndex !== null) return;
    const result = applyOpeningChoice(this.moves, this.openingPhase, choice);
    if (!result) return;
    this.moves = result.moves;
    this.openingPhase = result.nextPhase;
    this.currentPlayer = result.nextPlayer;
    if (result.swapColors && this.config.mode !== "local") {
      this.config.humanColor = otherPlayer(this.config.humanColor);
    }
    this.message = this.openingPhase === "place2"
      ? "后手请再摆放白、黑两子，之后交还先手选色"
      : this.openingPhase === "firstChoice"
        ? "五指局面已成，请选择你执黑还是执白"
        : "执子已确定，由白棋继续行棋";
    this.refreshBoard();
    this.audio.play("place");
    this.emit();
    this.scheduleMachine();
  }

  canPlace(point: Point): boolean {
    if (this.machine.state !== "playing" || this.thinking || this.reviewIndex !== null) return false;
    const actor = openingActor(this.config.opening, this.moves.length, this.openingPhase);
    if (actor === "second" || actor === "first") return false;
    if (this.config.mode !== "local" && this.currentPlayer !== this.config.humanColor) return false;
    return analyzeMove(boardFromMoves(this.moves), point.row, point.col, this.currentPlayer, this.config.rule).legal;
  }

  place(point: Point): boolean {
    if (!this.canPlace(point)) return false;
    return this.commitMove(point, false);
  }

  private commitMove(point: Point, machine: boolean): boolean {
    const analysis = analyzeMove(boardFromMoves(this.moves), point.row, point.col, this.currentPlayer, this.config.rule);
    if (!analysis.legal) {
      if (!machine) {
        this.message = FORBIDDEN_TEXT[analysis.reason ?? "occupied"];
        this.audio.play("invalid");
        this.emit();
      }
      return false;
    }
    const player = this.currentPlayer;
    this.moves.push({ ...point, player, number: this.moves.length + 1 });
    this.llmReason = "";
    this.audio.play("place");
    if (analysis.winningLine) {
      this.winner = player;
      this.winningLine = analysis.winningLine;
      this.message = `${playerName(player)}连成五子，赢得本局`;
      this.machine.finish();
      this.audio.play("win");
    } else if (this.moves.length === 225) {
      this.isDraw = true;
      this.message = "棋盘已满，本局和棋";
      this.machine.finish();
    } else {
      this.currentPlayer = otherPlayer(player);
      if (this.openingPhase) {
        this.openingPhase = afterOpeningMove(this.config.opening, this.moves.length, this.openingPhase);
        this.message = this.openingPhase === "secondChoice"
          ? "三手已成：后手可持白、交换为黑，或再摆两手"
          : this.openingPhase === "place2"
            ? "后手请再摆放白、黑两子"
            : "请按顺序摆放黑、白、黑三子";
      } else {
        this.message = `${playerName(this.currentPlayer)}行棋`;
      }
    }
    this.refreshBoard();
    this.emit();
    this.scheduleMachine();
    return true;
  }

  private refreshBoard() {
    const shown = this.reviewIndex === null ? this.moves : this.moves.slice(0, this.reviewIndex);
    this.scene.setPosition(shown, this.config.rule, this.showForbidden, this.machine.state === "playing");
    this.scene.setWinningLine(this.reviewIndex === null ? this.winningLine : null);
    this.scene.setTurn(this.currentPlayer);
  }

  private scheduleMachine(force = false) {
    window.clearTimeout(this.timer);
    if (this.machine.state !== "playing" || this.reviewIndex !== null) return;
    if (this.thinking && !force) return;
    const generation = ++this.generation;
    const actor = openingActor(this.config.opening, this.moves.length, this.openingPhase);
    const openingMachine = actor === "second" || actor === "first";
    if (this.config.mode === "local") return;
    if (!openingMachine && this.currentPlayer === this.config.humanColor) return;
    if (openingMachine) {
      const shouldChoose = actor === "second"
        ? this.config.humanColor === BLACK
        : this.config.humanColor === WHITE;
      if (!shouldChoose) return;
    }
    this.thinking = this.config.mode === "llm" ? "llm" : "local";
    this.message = this.config.mode === "llm" ? "大模型正在分析棋局…" : "本地 AI 正在计算最佳应手…";
    this.emit();
    const delay = this.config.mode === "llm" ? 80 : 180;
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation || this.machine.state !== "playing") return;
      if (openingMachine && this.config.mode === "ai") {
        const phase = this.openingPhase;
        if (phase !== "secondChoice" && phase !== "firstChoice") return;
        const choice = openingBalance(this.moves, phase);
        this.thinking = null;
        this.chooseOpening(choice);
        return;
      }
      if (this.config.mode === "ai") this.runLocalAI(generation);
      else if (this.config.mode === "llm") void this.runLLM(generation);
    }, delay);
  }

  private runLocalAI(generation: number) {
    const moves = this.moves.map((move) => ({ ...move }));
    const player = this.currentPlayer;
    this.localAI.search(moves, player, this.config.rule, this.config.level, (result) => {
      if (generation !== this.generation || this.machine.state !== "playing") return;
      this.thinking = null;
      this.searchStats = result.stats;
      if (result.move) this.commitMove(result.move, true);
      else {
        this.isDraw = true;
        this.message = "无合法落点，本局和棋";
        this.machine.finish();
        this.emit();
      }
    });
  }

  private async runLLM(generation: number) {
    this.abort = new AbortController();
    try {
      const result = await requestLLMMove(this.config.llm, boardFromMoves(this.moves), this.moves, this.currentPlayer, this.config.rule, this.abort.signal);
      if (generation !== this.generation || this.machine.state !== "playing") return;
      this.thinking = null;
      this.llmReason = result.reason;
      if (!this.commitMove(result.move, true)) throw new Error("大模型返回的落点未通过本地棋规校验");
    } catch (error) {
      if (generation !== this.generation) return;
      this.thinking = null;
      this.message = error instanceof Error ? `大模型落子失败：${error.message}` : "大模型落子失败，请重试";
      this.emit();
    }
  }

  private cancelPending() {
    this.generation++;
    window.clearTimeout(this.timer);
    this.abort?.abort();
    this.abort = null;
    this.localAI.cancel();
    this.thinking = null;
  }
}
