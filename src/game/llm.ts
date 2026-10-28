import { analyzeMove } from "./rules";
import { BLACK, coordinateName, otherPlayer, playerName, type Board, type LLMSettings, type Move, type Player, type Point, type RuleSet } from "./types";

export interface LLMMoveResult {
  move: Point;
  reason: string;
}

export interface LLMToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface LLMMessage {
  content?: string | Array<{ text?: string }> | null;
  tool_calls?: LLMToolCall[];
}

interface LLMChoice {
  finish_reason?: string;
  message?: LLMMessage;
}

const RULE_TEXT: Record<RuleSet, string> = {
  freestyle: "自由规则：五连或长连胜，无禁手。",
  standard: "标准规则：仅恰好五连胜，无禁手。",
  renju: "连珠规则：黑仅恰好五连胜，三三、四四、长连禁手；白无禁手，五连或长连胜。",
};

const PLACE_MOVE_TOOL = {
  type: "function",
  function: {
    name: "place_move",
    description: "在空且合法的交叉点落子",
    parameters: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 1, maximum: 15 },
        col: { type: "integer", minimum: 1, maximum: 15 },
      },
      required: ["row", "col"],
      additionalProperties: false,
    },
  },
};

export function parseLLMParameters(source: string): Record<string, unknown> {
  if (!source.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("模型参数不是有效的 JSON，请检查引号、逗号和括号");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型参数必须是 JSON 对象");
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null));
}

export function buildLLMRequestBody(settings: LLMSettings, messages: unknown[]): Record<string, unknown> {
  const parameters = parseLLMParameters(settings.parameters);
  const reasoningEffort = settings.reasoningEffort === "default" ? {} : { reasoning_effort: settings.reasoningEffort };
  const responseProtocol = settings.responseFormat === "tools" ? { tools: [PLACE_MOVE_TOOL] } : {};
  const body: Record<string, unknown> = { ...parameters, ...reasoningEffort, ...responseProtocol, model: settings.model, messages };
  // Some thinking models reject forced tool choices. Omitting it means auto and also
  // covers models that think by default, even when no reasoning_effort is selected.
  if (settings.responseFormat === "tools") delete body.tool_choice;
  return body;
}

function normalizeMove(parsed: { row?: number; col?: number; reason?: unknown }): LLMMoveResult | null {
  if (!Number.isInteger(parsed.row) || !Number.isInteger(parsed.col)) return null;
  const row = Number(parsed.row) - 1;
  const col = Number(parsed.col) - 1;
  if (row < 0 || row >= 15 || col < 0 || col >= 15) return null;
  return { move: { row, col }, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 180) : "" };
}

export function extractLLMMove(content: string): LLMMoveResult | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const object = fenced.match(/\{[\s\S]*?\}/)?.[0];
  if (!object) return null;
  try {
    return normalizeMove(JSON.parse(object) as { row?: number; col?: number; reason?: unknown });
  } catch {
    return null;
  }
}

export function extractLLMToolMove(toolCalls: LLMToolCall[] | undefined): LLMMoveResult | null {
  const call = toolCalls?.find((item) => item.function?.name === "place_move");
  if (!call?.function?.arguments) return null;
  try {
    return normalizeMove(JSON.parse(call.function.arguments) as { row?: number; col?: number });
  } catch {
    return null;
  }
}

function endpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function messageText(message: LLMMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("\n");
  return "";
}

async function requestOnce(
  settings: LLMSettings,
  messages: unknown[],
  signal: AbortSignal,
): Promise<LLMChoice> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint(settings.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(buildLLMRequestBody(settings, messages)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 160);
      throw new Error(`接口返回 ${response.status}${detail ? `：${detail}` : ""}`);
    }
    const data = await response.json() as { choices?: LLMChoice[] };
    const choice = data.choices?.[0];
    if (!choice) throw new Error("接口没有返回 choices，请检查响应格式");
    if (choice.finish_reason === "length") {
      throw new Error("模型输出长度不足，未生成落子。请提高 max_tokens／max_completion_tokens，或降低思考强度");
    }
    if (choice.finish_reason === "content_filter") throw new Error("模型输出被内容过滤器拦截，请调整模型或重试");
    if (messageText(choice.message).trim() || choice.message?.tool_calls?.length) return choice;
    throw new Error("接口没有返回可识别的落子，请检查落子格式、模型参数和响应格式");
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
    ? moves.map((move) => `${move.player === BLACK ? "B" : "W"}${coordinateName(move)}`).join(",")
    : "空";
  const action = settings.responseFormat === "tools"
    ? "立即调用place_move。"
    : '只输出{"row":行号,"col":列号}。';
  const system = `五子棋引擎。你执${playerName(player)}，对手执${playerName(otherPlayer(player))}。${RULE_TEXT[rule]}15×15，row/col均为1–15。优先五连，其次阻挡对手五连；不得占用已有棋子或选择禁手。${action}`;
  const user = `棋谱(按序,B黑W白)：${history}\n轮到你。`;
  const messages: unknown[] = [{ role: "system", content: system }, { role: "user", content: user }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const choice = await requestOnce(settings, messages, signal);
    const content = messageText(choice.message);
    const toolCalls = choice.message?.tool_calls;
    const parsed = settings.responseFormat === "tools"
      ? extractLLMToolMove(toolCalls) ?? (content ? extractLLMMove(content) : null)
      : extractLLMMove(content);
    let correction: string;
    if (parsed) {
      const analysis = analyzeMove(board, parsed.move.row, parsed.move.col, player, rule);
      if (analysis.legal) return parsed;
      correction = `坐标 ${coordinateName(parsed.move)} 不合法（${analysis.reason ?? "无法落子"}），请改选空且合法的位置。`;
    } else {
      correction = settings.responseFormat === "tools"
        ? "未识别到有效的place_move参数，请重新调用，row/col均为1–15整数。"
        : '回复无法解析，请只输出{"row":行号,"col":列号}。';
    }

    const toolCallId = settings.responseFormat === "tools" ? toolCalls?.[0]?.id : undefined;
    if (toolCallId) {
      // Preserve provider-specific fields such as reasoning_content on tool retries.
      messages.push({ role: "assistant", ...choice.message });
      messages.push({ role: "tool", tool_call_id: toolCallId, content: correction });
    } else {
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: correction });
    }
  }
  throw new Error("大模型连续两次未给出合法落点，请重试、切换落子格式或调整模型");
}
