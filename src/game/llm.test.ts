import { describe, expect, it } from "vitest";
import { extractLLMMove } from "./llm";

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
