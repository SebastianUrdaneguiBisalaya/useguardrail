import { AuthorizationError } from "@useguardril/core";
import { describe, expect, it } from "vitest";
import { MissingProviderError } from "../src/index.js";

describe("MissingProviderError", () => {
  it("defaults its code and extends AuthorizationError", () => {
    const error = new MissingProviderError("no provider");
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.code).toBe("PROVIDER_MISSING");
    expect(error.name).toBe("MissingProviderError");
  });

  it("keeps cause and params", () => {
    const cause = new Error("root");
    const error = new MissingProviderError("x", {
      cause,
      params: {
        where: "App",
      },
    });
    expect(error.cause).toBe(cause);
    expect(error.params).toEqual({
      where: "App",
    });
  });
});
