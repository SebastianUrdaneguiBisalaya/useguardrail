import { describe, expect, it } from "vitest";
import type { EvaluationInput } from "../../src/index.js";
import {
  createEngine,
  createRbacEvaluator,
  InvalidPolicyError,
} from "../../src/index.js";

const request = (
  roles: string[] | undefined,
  action: string,
  type = "invoice",
): EvaluationInput => ({
  action,
  context: {
    tenantId: "t1",
  },
  resource: {
    type,
  },
  subject: roles
    ? {
        id: "u1",
        roles,
      }
    : {
        id: "u1",
      },
});

const rbac = createRbacEvaluator({
  roles: {
    admin: {
      inherits: [
        "editor",
      ],
      permissions: [
        "user:*",
      ],
    },
    editor: {
      inherits: [
        "viewer",
      ],
      permissions: [
        "invoice:update",
      ],
    },
    root: {
      permissions: [
        "*",
      ],
    },
    viewer: {
      permissions: [
        "invoice:read",
        "*:export",
      ],
    },
  },
});

describe("createRbacEvaluator", () => {
  it("allows a direct permission", () => {
    expect(
      rbac(
        request(
          [
            "viewer",
          ],
          "read",
        ),
      )?.effect,
    ).toBe("allow");
  });

  it("allows through inheritance, transitively", () => {
    expect(
      rbac(
        request(
          [
            "admin",
          ],
          "read",
        ),
      )?.effect,
    ).toBe("allow");
    expect(
      rbac(
        request(
          [
            "admin",
          ],
          "update",
        ),
      )?.effect,
    ).toBe("allow");
  });

  it("supports wildcards on resource, action, and both", () => {
    expect(
      rbac(
        request(
          [
            "admin",
          ],
          "delete",
          "user",
        ),
      )?.effect,
    ).toBe("allow");
    expect(
      rbac(
        request(
          [
            "viewer",
          ],
          "export",
          "report",
        ),
      )?.effect,
    ).toBe("allow");
    expect(
      rbac(
        request(
          [
            "root",
          ],
          "anything",
          "whatever",
        ),
      )?.effect,
    ).toBe("allow");
  });

  it("has no opinion when nothing matches (never denies)", () => {
    expect(
      rbac(
        request(
          [
            "viewer",
          ],
          "update",
        ),
      ),
    ).toBeUndefined();
    expect(
      rbac(
        request(
          [
            "viewer",
          ],
          "read",
          "user",
        ),
      ),
    ).toBeUndefined();
  });

  it("ignores unknown roles and subjects without roles", () => {
    expect(
      rbac(
        request(
          [
            "ghost",
          ],
          "read",
        ),
      ),
    ).toBeUndefined();
    expect(rbac(request(undefined, "read"))).toBeUndefined();
  });

  it("default-denies through the engine", () => {
    const engine = createEngine({
      evaluators: [
        rbac,
      ],
    });
    expect(
      engine.evaluate(
        request(
          [
            "viewer",
          ],
          "update",
        ),
      ).effect,
    ).toBe("deny");
  });

  it("rejects an `inherits` that is not an array of strings", () => {
    expect(() =>
      createRbacEvaluator({
        roles: {
          a: {
            inherits: "b",
            permissions: [],
          },
        },
      } as never),
    ).toThrow(
      expect.objectContaining({
        code: "ROLE_INHERITS_INVALID",
      }),
    );
    expect(() =>
      createRbacEvaluator({
        roles: {
          a: {
            inherits: [
              1,
            ],
            permissions: [],
          },
        },
      } as never),
    ).toThrow(
      expect.objectContaining({
        code: "ROLE_INHERITS_INVALID",
      }),
    );
  });

  it("rejects malformed configuration", () => {
    const bad = (roles: unknown) => () =>
      createRbacEvaluator({
        roles,
      } as never);
    expect(bad(undefined)).toThrow(InvalidPolicyError);
    expect(bad([])).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: null,
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: {
          permissions: "x",
        },
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: {
          permissions: [
            "nocolon",
          ],
        },
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: {
          permissions: [
            ":read",
          ],
        },
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: {
          permissions: [
            "doc:",
          ],
        },
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        a: {
          inherits: [
            "missing",
          ],
          permissions: [],
        },
      }),
    ).toThrow(InvalidPolicyError);
  });

  it("detects inheritance cycles", () => {
    expect(() =>
      createRbacEvaluator({
        roles: {
          a: {
            inherits: [
              "b",
            ],
            permissions: [],
          },
          b: {
            inherits: [
              "a",
            ],
            permissions: [],
          },
        },
      }),
    ).toThrow(/cycle/);
    expect(() =>
      createRbacEvaluator({
        roles: {
          a: {
            inherits: [
              "a",
            ],
            permissions: [],
          },
        },
      }),
    ).toThrow(InvalidPolicyError);
  });
});
