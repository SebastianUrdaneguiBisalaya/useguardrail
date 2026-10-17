import { describe, expect, it } from "vitest";
import {
  AdapterMappingError,
  AuthorizationError,
  InvalidPolicyError,
} from "../src/index.js";

describe("errors", () => {
  it("subclasses are instances of AuthorizationError and Error", () => {
    const errors = [
      new InvalidPolicyError("a"),
      new AdapterMappingError("b"),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("sets a distinguishing name and preserves cause", () => {
    const cause = new Error("root");
    const error = new InvalidPolicyError("bad policy", {
      cause,
    });
    expect(error.name).toBe("InvalidPolicyError");
    expect(error.message).toBe("bad policy");
    expect(error.cause).toBe(cause);
    expect(new AdapterMappingError("x").name).toBe("AdapterMappingError");
  });

  it("sibling errors are not instances of each other", () => {
    expect(new InvalidPolicyError("a")).not.toBeInstanceOf(AdapterMappingError);
  });
});
