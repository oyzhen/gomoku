import { describe, expect, it } from "vitest";
import { buildLLMRequestBody, extractLLMMove, parseLLMParameters } from "./llm";
import type { LLMSettings } from "./types";

describe("LLM response parsing", () => {
  it("accepts plain and fenced JSON", () => {
    expect(extractLLMMove('{"row":8,"col":8,"reason":"占据天元"}')?.move).toEqual({ row: 7, col: 7 });
    expect(extractLLMMove('```json\n{"row":3,"col":15}\n```')?.move).toEqual({ row: 2, col: 14 });
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

  it("only sends reasoning_effort when explicitly selected", () => {
    const body = buildLLMRequestBody({ ...settings, reasoningEffort: "high" }, []);
    expect(body.reasoning_effort).toBe("high");
  });

  it("rejects malformed or non-object parameter JSON", () => {
    expect(() => parseLLMParameters("{")).toThrow("有效的 JSON");
    expect(() => parseLLMParameters("[]")).toThrow("JSON 对象");
  });
});
