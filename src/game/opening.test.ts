import { describe, expect, it } from "vitest";
import { afterOpeningMove, applyOpeningChoice, openingActor, openingAfterUndo } from "./opening";
import { BLACK, WHITE } from "./types";

describe("Swap2 opening protocol", () => {
  it("lets the opener place black-white-black before the second chooses", () => {
    expect(afterOpeningMove("place3", 1)).toEqual({ phase: "place3", currentPlayer: WHITE });
    expect(afterOpeningMove("place3", 2)).toEqual({ phase: "place3", currentPlayer: BLACK });
    expect(afterOpeningMove("place3", 3)).toEqual({ phase: "secondChoice", currentPlayer: WHITE });
    expect(openingActor("secondChoice")).toBe(WHITE);
  });

  it("supports staying, swapping, and white moving next", () => {
    expect(applyOpeningChoice("secondChoice", "white")).toEqual({ phase: null, currentPlayer: WHITE, swap: false });
    expect(applyOpeningChoice("secondChoice", "black")).toEqual({ phase: null, currentPlayer: WHITE, swap: true });
  });

  it("supports the five-stone branch and returns the choice to the opener", () => {
    expect(applyOpeningChoice("secondChoice", "extend")?.phase).toBe("place2");
    expect(afterOpeningMove("place2", 4)).toEqual({ phase: "place2", currentPlayer: BLACK });
    expect(afterOpeningMove("place2", 5)).toEqual({ phase: "firstChoice", currentPlayer: WHITE });
    expect(openingActor("firstChoice")).toBe(BLACK);
    expect(applyOpeningChoice("firstChoice", "white")?.swap).toBe(true);
    expect(applyOpeningChoice("firstChoice", "black")?.swap).toBe(false);
  });

  it("restores the correct opening stage after undo", () => {
    expect(openingAfterUndo(2)).toBe("place3");
    expect(openingAfterUndo(3)).toBe("secondChoice");
    expect(openingAfterUndo(4)).toBe("place2");
    expect(openingAfterUndo(5)).toBe("firstChoice");
    expect(openingAfterUndo(6)).toBeNull();
  });
});
