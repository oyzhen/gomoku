import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Bot, BrainCircuit, Camera, Check, ChevronRight, CircleHelp, Eye, EyeOff,
  Flag, Keyboard, ListOrdered, MousePointer2, Pause, Play, RefreshCw, RotateCcw,
  Sparkles, Undo2, Users, Volume2, VolumeX, X,
} from "lucide-react";
import { startGame, stopGame } from "@/game/boot";
import { DEFAULT_CONFIG, type GomokuController } from "@/game/controller";
import { getAIProfile } from "@/game/ai-core";
import { parseLLMParameters } from "@/game/llm";
import { storage } from "@/game/storage";
import { THEME_ORDER, THEMES } from "@/game/themes";
import { BLACK, coordinateName, WHITE, type GameConfig, type GameSnapshot, type Player } from "@/game/types";

const RULES = {
  freestyle: { name: "自由五子棋", short: "五连或长连获胜", detail: "双方均无禁手，五连及以上获胜。轻松直接，适合熟悉棋盘。" },
  standard: { name: "标准五子棋", short: "恰好五连获胜", detail: "双方均无禁手，只有恰好五连获胜；六连及以上继续对局。" },
  renju: { name: "连珠 · 有禁手", short: "黑棋三三、四四、长连禁手", detail: "黑棋恰好五连获胜，三三、四四、长连为禁手；白棋无禁手，五连或长连获胜。" },
} as const;

const INITIAL_SNAPSHOT: GameSnapshot = {
  status: "title", mode: "ai", rule: "freestyle", level: 35, humanColor: BLACK,
  currentPlayer: BLACK, moves: [], winner: null, isDraw: false, thinking: null,
  message: "选择对局方式，落子开局", llmReason: "", reviewIndex: null,
  muted: false, theme: "walnut", showForbidden: true, opening: "none", openingPhase: null, searchStats: null,
};

function loadConfig(): GameConfig {
  const fallback = structuredClone(DEFAULT_CONFIG);
  try {
    const saved = storage.get<Partial<GameConfig>>("xuanping.config.v1", {});
    const config = { ...fallback, ...saved, llm: { ...fallback.llm, ...saved.llm } };
    if (!["ai", "local", "llm"].includes(config.mode)) config.mode = "ai";
    if (!["freestyle", "standard", "renju"].includes(config.rule)) config.rule = "freestyle";
    if (!THEME_ORDER.includes(config.theme)) config.theme = "walnut";
    config.level = Math.max(1, Math.min(100, Number(config.level) || 35));
    config.humanColor = config.humanColor === WHITE ? WHITE : BLACK;
    config.opening = config.opening === "swap2" ? "swap2" : "none";
    config.llm.apiKey = sessionStorage.getItem("xuanping.llm.key") ?? "";
    return config;
  } catch {
    return fallback;
  }
}

function playerLabel(snapshot: GameSnapshot, color: Player): string {
  if (snapshot.mode === "local") return color === BLACK ? "黑方" : "白方";
  if (snapshot.humanColor === color) return "你";
  return snapshot.mode === "llm" ? "AI 大模型" : `本地 AI · ${snapshot.level} 级`;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GomokuController | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const [config, setConfig] = useState<GameConfig>(loadConfig);
  const [formError, setFormError] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    controllerRef.current = startGame(canvas, setSnapshot);
    controllerRef.current.setTheme(config.theme);
    return () => {
      controllerRef.current = null;
      stopGame();
    };
    // The game shell mounts exactly once; theme changes have a separate path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    storage.set("xuanping.config.v1", { ...config, llm: { ...config.llm, apiKey: "" } });
    try { sessionStorage.setItem("xuanping.llm.key", config.llm.apiKey); } catch { /* session storage may be blocked */ }
    controllerRef.current?.setTheme(config.theme);
  }, [config]);

  useEffect(() => {
    if (snapshot.status === "playing") setResultDismissed(false);
  }, [snapshot.status]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" });
  }, [snapshot.moves.length]);

  const begin = () => {
    if (config.mode === "llm") {
      if (!config.llm.baseUrl.trim() || !config.llm.model.trim() || !config.llm.apiKey.trim()) {
        setFormError("请完整填写接口地址、模型名称和 API Key");
        return;
      }
      try {
        parseLLMParameters(config.llm.parameters);
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "模型参数格式不正确");
        return;
      }
    }
    setFormError("");
    controllerRef.current?.start(config);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const controller = controllerRef.current;
      if (!controller) return;
      if (event.code === "Space" && snapshot.status === "title") {
        event.preventDefault();
        begin();
      } else if (event.code === "Escape") {
        if (showRules) setShowRules(false);
        else if (snapshot.status === "playing") controller.pause();
        else if (snapshot.status === "paused") controller.resume();
      } else if (event.code === "KeyM") controller.toggleMute();
      else if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
        event.preventDefault();
        controller.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot.status, showRules, config]);

  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => setConfig((old) => ({ ...old, [key]: value }));
  const updateLLM = <K extends keyof GameConfig["llm"]>(key: K, value: GameConfig["llm"][K]) => setConfig((old) => ({ ...old, llm: { ...old.llm, [key]: value } }));
  const activeTheme = snapshot.status === "title" ? config.theme : snapshot.theme;
  const profile = getAIProfile(config.level);
  const machineChoice = snapshot.openingPhase === "secondChoice" ? WHITE : snapshot.openingPhase === "firstChoice" ? BLACK : null;
  const showOpeningChoice = snapshot.status === "playing" && machineChoice !== null && !snapshot.thinking && (snapshot.mode === "local" || machineChoice === snapshot.humanColor);
  const machineTurn = snapshot.mode !== "local" && snapshot.currentPlayer !== snapshot.humanColor;
  const canRetry = snapshot.status === "playing" && !snapshot.thinking && (machineTurn || machineChoice !== null) && /失败|中断|超时|两次|长度|输出|接口|参数|拦截/.test(snapshot.message);

  return (
    <div id="game-root" data-theme={activeTheme}>
      <canvas id="game-canvas" ref={canvasRef} aria-label="三维五子棋棋盘，点击交叉点落子" />

      {snapshot.status === "title" ? (
        <main className="title-screen">
          <section className="title-intro">
            <div className="brand-mark"><span>玄</span><i /></div>
            <p className="eyebrow">XUANPING · GOMOKU</p>
            <h1>玄枰<span>五子棋</span></h1>
            <p className="title-copy">一方棋盘，百级棋力。<br />在木纹、青瓷与星穹之间，下一局好棋。</p>
            <div className="title-features">
              <span><Bot size={15} />100 级本地 AI</span>
              <span><Users size={15} />同页双人</span>
              <span><Sparkles size={15} />Swap2 交换开局</span>
            </div>
            <div className="keyboard-note"><Keyboard size={16} /><span>空格快速开局</span><kbd>Space</kbd></div>
          </section>

          <section className="setup-card" aria-label="对局设置">
            <div className="setup-heading"><div><p className="eyebrow">NEW MATCH</p><h2>对局设置</h2></div><span className="step-chip">15 × 15</span></div>
            <div className="mode-tabs" role="tablist" aria-label="对局模式">
              <button className={config.mode === "ai" ? "active" : ""} onClick={() => update("mode", "ai")} data-testid="mode-ai"><Bot size={17} />人机对战</button>
              <button className={config.mode === "local" ? "active" : ""} onClick={() => update("mode", "local")} data-testid="mode-local"><Users size={17} />双人对弈</button>
              <button className={config.mode === "llm" ? "active" : ""} onClick={() => update("mode", "llm")} data-testid="mode-llm"><BrainCircuit size={17} />大模型</button>
            </div>

            {config.mode === "ai" && (
              <div className="setting-block level-block">
                <div className="setting-label"><label htmlFor="ai-level">AI 棋力</label><div><strong>{config.level}</strong><span>/ 100 · {profile.label}</span></div></div>
                <input id="ai-level" data-testid="level-slider" type="range" min="1" max="100" value={config.level} onChange={(e) => update("level", Number(e.target.value))} style={{ "--range": `${config.level - 1}%` } as React.CSSProperties} />
                <div className="range-marks"><span>轻松</span><span>进阶</span><span>高手</span><span>巅峰</span></div>
                <div className="profile-detail"><span>搜索 {profile.depth} 层</span><span>候选 {profile.candidates} 点</span><span>预算 {(profile.timeMs / 1000).toFixed(2)} 秒</span></div>
              </div>
            )}
            {config.mode === "local" && <div className="mode-note"><Users size={19} /><div><strong>同页轮流落子</strong><span>可与身边的朋友对弈，也可以左右手自我推演。</span></div></div>}
            {config.mode === "llm" && (
              <div className="llm-fields">
                <label>接口地址<input value={config.llm.baseUrl} onChange={(e) => updateLLM("baseUrl", e.target.value)} placeholder="https://api.example.com/v1" /></label>
                <label>模型名称<input value={config.llm.model} onChange={(e) => updateLLM("model", e.target.value)} placeholder="填写服务商支持的模型 ID" /></label>
                <label>API Key<input type="password" value={config.llm.apiKey} onChange={(e) => updateLLM("apiKey", e.target.value)} placeholder="仅保留在当前标签页" autoComplete="off" /></label>
                <label>思考强度<select value={config.llm.reasoningEffort} onChange={(e) => updateLLM("reasoningEffort", e.target.value as GameConfig["llm"]["reasoningEffort"])}><option value="default">服务商默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
                <label className="model-params">模型参数（JSON）<textarea value={config.llm.parameters} onChange={(e) => updateLLM("parameters", e.target.value)} spellCheck={false} aria-label="模型参数 JSON" /></label>
                <p>可调整 max_tokens、temperature 等参数；设为 null 可删除一项。高推理模型若报错，可改用 max_completion_tokens，并将 temperature 设为 null。思考强度仅在非默认时发送 reasoning_effort。</p>
                <p>OpenAI 兼容的 /chat/completions 接口；服务商需允许浏览器跨域。密钥不会上传至本游戏服务器或写入仓库。</p>
              </div>
            )}

            <div className="setting-row">
              <div className="setting-block">
                <div className="setting-label"><span>胜负与禁手</span><button className="text-button" onClick={() => setShowRules(true)}>规则说明<ChevronRight size={13} /></button></div>
                <div className="rule-options">
                  {(Object.keys(RULES) as Array<keyof typeof RULES>).map((rule) => <button key={rule} className={config.rule === rule ? "active" : ""} onClick={() => update("rule", rule)}><strong>{RULES[rule].name}</strong><span>{RULES[rule].short}</span></button>)}
                </div>
              </div>
            </div>

            <button className={`opening-toggle ${config.opening === "swap2" ? "active" : ""}`} onClick={() => update("opening", config.opening === "swap2" ? "none" : "swap2")} role="switch" aria-checked={config.opening === "swap2"} data-testid="opening-toggle">
              <span className="toggle-icon"><Sparkles size={17} /></span><span><strong>Swap2 交换开局</strong><small>三手后选色，或再摆两手交还选色</small></span><i>{config.opening === "swap2" && <Check size={13} />}</i>
            </button>

            <div className="compact-settings">
              {config.mode !== "local" && <div><span className="compact-label">你的执子</span><div className="color-choice"><button className={config.humanColor === BLACK ? "active" : ""} onClick={() => update("humanColor", BLACK)}><i className="stone black" />黑棋先行</button><button className={config.humanColor === WHITE ? "active" : ""} onClick={() => update("humanColor", WHITE)}><i className="stone white" />白棋后行</button></div></div>}
              <div><span className="compact-label">棋盘风格</span><div className="theme-choice">{THEME_ORDER.map((id) => <button key={id} title={THEMES[id].name} className={config.theme === id ? "active" : ""} onClick={() => update("theme", id)}><i style={{ background: THEMES[id].swatch }} /><span>{THEMES[id].name}</span></button>)}</div></div>
            </div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="start-button" onClick={begin} data-testid="start-game"><Play size={18} fill="currentColor" />落子开局<span>Space</span></button>
          </section>
        </main>
      ) : (
        <div id="ui-overlay" className="game-ui">
          <header className="topbar">
            <div className="mini-brand"><span>玄枰</span><i>GOMOKU</i></div>
            <div className="match-tags"><span>{snapshot.mode === "ai" ? "人机对战" : snapshot.mode === "local" ? "双人对弈" : "大模型对战"}</span><span>{RULES[snapshot.rule].name}</span>{snapshot.opening === "swap2" && <span>Swap2</span>}</div>
            <div className="top-actions">
              <button onClick={() => setShowRules(true)} title="规则说明"><CircleHelp size={18} /><span>规则</span></button>
              <button onClick={() => controllerRef.current?.toggleMute()} title={snapshot.muted ? "开启音效 (M)" : "静音 (M)"}>{snapshot.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}<span>{snapshot.muted ? "已静音" : "音效"}</span></button>
              <button onClick={() => controllerRef.current?.toMenu()} title="返回对局设置"><ArrowLeft size={18} /><span>设置</span></button>
            </div>
          </header>

          <aside className="player-panel glass-panel">
            <p className="eyebrow">MOVE {String(snapshot.moves.length + (snapshot.status === "gameover" ? 0 : 1)).padStart(2, "0")}</p>
            <h2>{snapshot.status === "gameover" ? "对局结束" : snapshot.thinking ? "正在思考" : snapshot.openingPhase ? "交换开局" : `${snapshot.currentPlayer === BLACK ? "黑棋" : "白棋"}行棋`}</h2>
            <p className="turn-caption">{snapshot.openingPhase === "place3" ? "先手摆放黑、白、黑" : snapshot.openingPhase === "place2" ? "后手摆放白、黑" : snapshot.openingPhase ? "确定执子后继续" : "连成五子，即为胜者"}</p>
            <div className="players">
              {([BLACK, WHITE] as Player[]).map((color) => <div key={color} className={`player-card ${snapshot.currentPlayer === color && snapshot.status === "playing" ? "active" : ""} ${snapshot.winner === color ? "winner" : ""}`}><i className={`stone ${color === BLACK ? "black" : "white"}`} /><div><strong>{playerLabel(snapshot, color)}</strong><span>{color === BLACK ? "黑棋" : "白棋"}{snapshot.winner === color ? " · 获胜" : ""}</span></div>{snapshot.currentPlayer === color && snapshot.status === "playing" && <i className="turn-pulse" />}</div>)}
            </div>
            <div className="game-message" aria-live="polite">{snapshot.thinking && <span className="spinner" />}<span>{snapshot.message}</span></div>
            {canRetry && <button className="retry-button" onClick={() => controllerRef.current?.retry()}><RefreshCw size={14} />重试本轮</button>}
            {snapshot.llmReason && <div className="ai-note"><BrainCircuit size={15} /><div><strong>大模型落子理由</strong><p>{snapshot.llmReason}</p></div></div>}
            {snapshot.searchStats && snapshot.mode === "ai" && <div className="search-stats"><span>搜索 {snapshot.searchStats.depth} 层</span><span>{snapshot.searchStats.nodes.toLocaleString()} 节点</span><span>{snapshot.searchStats.elapsed} ms</span></div>}
            <div className="shortcut-list"><span><kbd>Esc</kbd>暂停</span><span><kbd>Ctrl Z</kbd>悔棋</span><span><MousePointer2 size={13} />拖动旋转</span></div>
          </aside>

          <aside className={`history-panel glass-panel ${showHistory ? "mobile-open" : ""}`}>
            <div className="history-heading"><div><ListOrdered size={16} /><strong>对局棋谱</strong></div><button className="mobile-close" onClick={() => setShowHistory(false)}><X size={17} /></button></div>
            {snapshot.reviewIndex !== null && <button className="return-live" onClick={() => controllerRef.current?.exitReview()}><Play size={13} />返回当前局面</button>}
            <div className="history-list" ref={historyRef}>
              {snapshot.moves.length === 0 ? <div className="empty-history"><i className="stone black" /><p>尚未落子<br /><span>每一步都会记录在这里</span></p></div> : snapshot.moves.map((move) => <button key={move.number} className={snapshot.reviewIndex === move.number ? "active" : ""} onClick={() => controllerRef.current?.review(move.number)}><span>{String(move.number).padStart(2, "0")}</span><i className={`stone ${move.player === BLACK ? "black" : "white"}`} /><strong>{coordinateName(move)}</strong><small>{move.player === BLACK ? "黑" : "白"}</small></button>)}
            </div>
          </aside>

          {showOpeningChoice && <section className="opening-choice glass-panel" data-testid="opening-choice"><div><Sparkles size={18} /><span>{snapshot.openingPhase === "secondChoice" ? "后手选色，或增加变化" : "先手选择执子"}</span></div><div className="opening-actions">{snapshot.openingPhase === "secondChoice" ? <><button onClick={() => controllerRef.current?.chooseOpening("white")}><i className="stone white" />持白继续</button><button onClick={() => controllerRef.current?.chooseOpening("black")}><i className="stone black" />交换为黑</button><button onClick={() => controllerRef.current?.chooseOpening("extend")}><Sparkles size={14} />再摆两手</button></> : <><button onClick={() => controllerRef.current?.chooseOpening("black")}><i className="stone black" />选择黑棋</button><button onClick={() => controllerRef.current?.chooseOpening("white")}><i className="stone white" />选择白棋</button></>}</div><p>选色完成后，由白棋继续行棋</p></section>}

          <footer className="game-toolbar glass-panel">
            <button onClick={() => controllerRef.current?.undo()} disabled={!snapshot.moves.length || snapshot.status === "paused"} title="悔棋 (Ctrl+Z)"><Undo2 size={18} /><span>悔棋</span></button>
            <button onClick={() => snapshot.status === "paused" ? controllerRef.current?.resume() : controllerRef.current?.pause()} disabled={snapshot.status === "gameover"} data-testid="pause-game"><Pause size={18} /><span>{snapshot.status === "paused" ? "继续" : "暂停"}</span></button>
            <button onClick={() => controllerRef.current?.restart()}><RotateCcw size={18} /><span>重开</span></button>
            <button onClick={() => controllerRef.current?.resign()} disabled={snapshot.status !== "playing"}><Flag size={18} /><span>认输</span></button>
            <i className="toolbar-divider" />
            <button onClick={() => controllerRef.current?.resetView()} title="恢复立体视角"><Camera size={18} /><span>视角</span></button>
            <button onClick={() => controllerRef.current?.resetView(true)} title="俯视棋盘"><Eye size={18} /><span>俯视</span></button>
            <button onClick={() => controllerRef.current?.toggleForbidden()} disabled={snapshot.rule !== "renju"} title="显示或隐藏黑棋禁手点">{snapshot.showForbidden ? <EyeOff size={18} /> : <Eye size={18} />}<span>禁手点</span></button>
            <button className="history-mobile-button" onClick={() => setShowHistory(true)}><ListOrdered size={18} /><span>棋谱</span></button>
          </footer>
        </div>
      )}

      {snapshot.status === "paused" && <div className="modal-backdrop"><section className="pause-modal modal-card"><p className="eyebrow">MATCH PAUSED</p><h2>棋局已暂停</h2><p>当前局面已保留，准备好后继续。</p><button className="start-button" onClick={() => controllerRef.current?.resume()} data-testid="resume-game"><Play size={17} />继续对局</button><button className="secondary-button" onClick={() => controllerRef.current?.restart()}><RotateCcw size={16} />重新开始</button><button className="text-button centered" onClick={() => controllerRef.current?.toMenu()}>返回对局设置</button></section></div>}

      {snapshot.status === "gameover" && !resultDismissed && <div className="modal-backdrop result-backdrop"><section className="result-modal modal-card" data-testid="result-modal"><div className={`result-stone stone ${snapshot.winner === WHITE ? "white" : "black"}`} /><p className="eyebrow">MATCH COMPLETE</p><h2>{snapshot.isDraw ? "和棋" : `${snapshot.winner === BLACK ? "黑棋" : "白棋"}获胜`}</h2><p>{snapshot.message}</p><div className="result-stats"><span><strong>{snapshot.moves.length}</strong>总手数</span><span><strong>{snapshot.mode === "ai" ? snapshot.level : "—"}</strong>AI 等级</span><span><strong>{RULES[snapshot.rule].name}</strong>对局规则</span></div><button className="start-button" onClick={() => controllerRef.current?.restart()}><RefreshCw size={17} />再来一局</button><button className="secondary-button" onClick={() => setResultDismissed(true)}><ListOrdered size={16} />查看棋盘与棋谱</button><button className="text-button centered" onClick={() => controllerRef.current?.toMenu()}>返回对局设置</button></section></div>}

      {showRules && <div className="modal-backdrop drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowRules(false); }}><section className="rules-drawer"><div className="drawer-heading"><div><p className="eyebrow">RULEBOOK</p><h2>规则与操作</h2></div><button onClick={() => setShowRules(false)}><X size={20} /></button></div>{(Object.keys(RULES) as Array<keyof typeof RULES>).map((rule) => <div className="rule-detail" key={rule}><strong>{RULES[rule].name}</strong><p>{RULES[rule].detail}</p></div>)}<div className="rule-detail accent"><strong>Swap2 交换开局</strong><p>先手摆黑、白、黑三子；后手可持白、交换为黑，或再摆白、黑两子并让先手选色。所有分支均由白棋继续。它是开局协议，可叠加到上方任一胜负规则。</p></div><div className="rule-detail"><strong>禁手提示</strong><p>连珠规则下默认显示黑棋禁手点。禁手判断会递归检查“假三”，并以恰好五连优先；不包含竞赛中的认禁手势流程。</p></div><div className="rule-detail"><strong>操作</strong><p>点击交叉点落子；拖动旋转棋盘，滚轮缩放。Esc 暂停，M 静音，Ctrl / ⌘ + Z 悔棋。棋谱支持逐手回看。</p></div><div className="rule-detail"><strong>数据与密钥</strong><p>设置和棋谱只存在当前浏览器；棋谱不会跨设备同步。大模型密钥仅保留在当前标签页，接口调用直接从浏览器发往你配置的服务商。</p></div></section></div>}
    </div>
  );
}
