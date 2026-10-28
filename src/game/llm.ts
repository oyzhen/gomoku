import { analyzeMove, boardToText } from "./rules";
import { BLACK, coordinateName, otherPlayer, playerName, type Board, type LLMSettings, type Move, type Player, type Point, type RuleSet } from "./types";

export interface LLMMoveResult {
  move: Point;
  reason: string;
}

const RULE_TEXT: Record<RuleSet, string> = {
  freestyle: "自由规则：任意一方五连或长连均获胜，无禁手。",
  standard: "标准规则：任意一方恰好五连获胜，六连及以上不算获胜，无禁手。",
  renju: "连珠规则：黑棋恰好五连获胜，三三、四四、长连为禁手；白棋无禁手，五连或长连获胜。",
};

export function extractLLMMove(content: string): { move: Point; reason: string } | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const object = fenced.match(/\{[\s\S]*?\}/)?.[0];
  if (!object) return null;
  try {
    const parsed = JSON.parse(object) as { row?: number; col?: number; reason?: unknown };
    if (!Number.isInteger(parsed.row) || !Number.isInteger(parsed.col)) return null;
    const row = Number(parsed.row) - 1;
    const col = Number(parsed.col) - 1;
    if (row < 0 || row >= 15 || col < 0 || col >= 15) return null;
    return { move: { row, col }, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 180) : "" };
  } catch {
    return null;
  }
}

function endpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

async function requestOnce(
  settings: LLMSettings,
  messages: unknown[],
  signal: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint(settings.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, messages, temperature: 0.2, max_tokens: 320 }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 160);
      throw new Error(`接口返回 ${response.status}${detail ? `：${detail}` : ""}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("\n");
    throw new Error("接口没有返回可识别的文本内容");
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal.aborted ? "对局已取消" : "大模型响应超时（30 秒）");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", relay);
  }
}

export async function requestLLMMove(
  settings: LLMSettings,
  board: Board,
  moves: readonly Move[],
  player: Player,
  rule: RuleSet,
  signal: AbortSignal,
): Promise<LLMMoveResult> {
  const history = moves.length
    ? moves.map((move) => `${move.number}. ${playerName(move.player)} ${coordinateName(move)}`).join("，")
    : "暂无";
  const system = `你是一名五子棋对局引擎。你执${playerName(player)}（${player === BLACK ? "X" : "O"}），对手执${playerName(otherPlayer(player))}。${RULE_TEXT[rule]}棋盘为 15×15，列 A-O，行 1-15。只返回 JSON：{\"row\":行号数字,\"col\":列号数字,\"reason\":\"不超过40字的中文理由\"}。row 和 col 都从 1 开始，例如 H8 对应 row=8,col=8。不得下在已有棋子的位置，不得选择禁手。优先完成自己的五连，其次阻挡对手的直接五连。`;
  const user = `当前棋盘（X=黑，O=白，.=空）：\n${boardToText(board)}\n\n棋谱：${history}\n轮到你执${playerName(player)}，请给出一个合法坐标。`;
  const messages: unknown[] = [{ role: "system", content: system }, { role: "user", content: user }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await requestOnce(settings, messages, signal);
    const parsed = extractLLMMove(content);
    if (parsed) {
      const analysis = analyzeMove(board, parsed.move.row, parsed.move.col, player, rule);
      if (analysis.legal) return parsed;
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `坐标 ${coordinateName(parsed.move)} 不合法（${analysis.reason ?? "无法落子"}）。请根据棋盘重新选择一个空且合法的位置，只返回 JSON。` });
    } else {
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: "上次回复无法解析。请只返回包含 row、col、reason 的 JSON 对象，坐标从 1 开始。" });
    }
  }
  throw new Error("大模型连续两次未给出合法落点，请重试或调整模型");
}
