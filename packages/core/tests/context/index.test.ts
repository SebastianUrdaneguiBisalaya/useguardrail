import { describe, expect, it } from "vitest";
import { createContext, InvalidContextError } from "../../src/index.js";

describe("createContext", () => {
  it("returns an empty frozen context by default", () => {
    const context = createContext();
    expect(context).toEqual({});
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("keeps tenantId and attributes, copying and freezing attributes", () => {
    const attributes = {
      plan: "pro",
    };
    const context = createContext({
      attributes,
      tenantId: "acme",
    });
    expect(context).toEqual({
      attributes: {
        plan: "pro",
      },
      tenantId: "acme",
    });
    attributes.plan = "free";
    expect(context.attributes).toEqual({
      plan: "pro",
    });
    expect(Object.isFrozen(context.attributes)).toBe(true);
  });

  it("rejects malformed input", () => {
    const bad = (input: unknown) => () => createContext(input as never);
    expect(bad(null)).toThrow(InvalidContextError);
    expect(bad([])).toThrow(InvalidContextError);
    expect(
      bad({
        tenantId: "",
      }),
    ).toThrow(InvalidContextError);
    expect(
      bad({
        tenantId: 5,
      }),
    ).toThrow(InvalidContextError);
    expect(
      bad({
        attributes: "x",
      }),
    ).toThrow(InvalidContextError);
    expect(
      bad({
        attributes: [],
      }),
    ).toThrow(InvalidContextError);
  });
});
