import { describe, expect, it } from "vitest";
import { findNeighbors } from "./session-neighbors";

describe("findNeighbors", () => {
  it("returns prev and next for a middle item", () => {
    expect(findNeighbors(["a", "b", "c"], "b")).toEqual({ prev: "a", next: "c" });
  });

  it("returns null prev at the start", () => {
    expect(findNeighbors(["a", "b", "c"], "a")).toEqual({ prev: null, next: "b" });
  });

  it("returns null next at the end", () => {
    expect(findNeighbors(["a", "b", "c"], "c")).toEqual({ prev: "b", next: null });
  });

  it("returns both null when the id is not in the list", () => {
    expect(findNeighbors(["a", "b"], "z")).toEqual({ prev: null, next: null });
  });

  it("returns both null for a single-item list", () => {
    expect(findNeighbors(["only"], "only")).toEqual({ prev: null, next: null });
  });
});
