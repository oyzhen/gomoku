import { describe, expect, it } from "vitest";
import { buildLLMRequestBody, extractLLMMove, extractLLMToolMove, parseLLMParameters } from "./llm";
import type { LLMSettings } from "./types";

describe("LLM response parsing", () => {
  it("accepts plain and fenced JSON", () => {
    expect(extractLLMMove('{"row":8,"col":8,"reason":"占据天元"}')?.move).toEqual({ row: 7, col: 7 });
    expect(extractLLMMove('```json\n{"row":3,"col":15}\n```')?.move).toEqual({ row: 2, col: 14 });
  });

  it("accepts place_move tool arguments without requiring prose", () => {
    const result = extractLLMToolMove([{ id: "call_1", function: { name: "place_move", arguments: '{"row":9,"col":9}' } }]);
    expect(result).toEqual({ move: { row: 8, col: 8 }, reason: "" });
    expect(extractLLMToolMove([{ function: { name: "place_move", arguments: "{" } }])).toBeNull();
  });

  it("rejects invalid coordinates and malformed output", () => {
    expect(extractLLMMove('{"row":0,"col":8}')).toBeNull();
    expect(extractLLMMove("我无法决定")).toBeNull();
  });
});

describe("configurable model parameters", () => {
  const settings: LLMSettings = {
    baseUrl: "http://mock.local/v1",
    apiKey: "test",
    model: "test-model",
    responseFormat: "tools",
    reasoningEffort: "default",
    parameters: '{"max_tokens":4096,"temperature":null}',
  };

  it("uses the configured output budget and removes null fields", () => {
    const messages = [{ role: "user", content: "move" }];
    const body = buildLLMRequestBody(settings, messages);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.model).toBe("test-model");
    expect(body.messages).toBe(messages);
  });

  it("requires the compact place_move tool by default", () => {
    const body = buildLLMRequestBody(settings, []);
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "place_move" } });
    const tools = body.tools as Array<{ function: { name: string; parameters: { required: string[] } } }>;
    expect(tools[0].function.name).toBe("place_move");
    expect(tools[0].function.parameters.required).toEqual(["row", "col"]);
  });

  it("omits tool protocol fields in JSON compatibility mode", () => {
    const body = buildLLMRequestBody({ ...settings, responseFormat: "json" }, []);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("only sends reasoning_effort when explicitly selected", () => {
    const body = buildLLMRequestBody({ ...settings, reasoningEffort: "high" }, []);
    expect(body.reasoning_effort).toBe("high");
  });

  it("rejects malformed or non-object parameter JSON", () => {
    expect(() => parseLLMParameters("{")).toThrow("有效的 JSON");
    expect(() => parseLLMParameters("[]")).toThrow("JSON 对象");
  });
});
