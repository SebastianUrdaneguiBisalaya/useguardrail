import { AdapterMappingError } from "@useguardrail/core";
import { describe, expect, it } from "vitest";
import { createSessionAdapter } from "../../src/index.js";

const response = {
  organization: {
    id: 7,
  },
  user: {
    department: "sales",
    id: "u-1",
    nickname: null,
    roles: [
      {
        name: "editor",
      },
      {
        name: "viewer",
      },
    ],
  },
};

describe("createSessionAdapter", () => {
  it("maps subject, roles, attributes, and tenant from configurable paths", () => {
    const adapt = createSessionAdapter({
      attributes: {
        department: "user.department",
        nickname: "user.nickname",
      },
      contextAttributes: {
        plan: "organization.plan",
      },
      roleKey: "name",
      roles: "user.roles",
      subjectId: "user.id",
      tenantId: "organization.id",
    });
    expect(adapt(response)).toEqual({
      context: {
        tenantId: "7",
      },
      subject: {
        attributes: {
          department: "sales",
        },
        id: "u-1",
        roles: [
          "editor",
          "viewer",
        ],
      },
    });
  });

  it("maps context attributes when present", () => {
    const adapt = createSessionAdapter({
      contextAttributes: {
        plan: "organization.plan",
      },
      subjectId: "id",
      tenantId: "organization.id",
    });
    expect(
      adapt({
        id: "u",
        organization: {
          id: "o",
          plan: "pro",
        },
      }),
    ).toEqual({
      context: {
        attributes: {
          plan: "pro",
        },
        tenantId: "o",
      },
      subject: {
        id: "u",
      },
    });
  });

  it("accepts roles as plain strings and numeric ids", () => {
    const adapt = createSessionAdapter({
      roles: "roles",
      subjectId: "id",
    });
    expect(
      adapt({
        id: 42,
        roles: [
          "a",
          "b",
        ],
      }),
    ).toEqual({
      context: {},
      subject: {
        id: "42",
        roles: [
          "a",
          "b",
        ],
      },
    });
  });

  it("omits optional pieces that are absent, and treats missing roles as none", () => {
    const adapt = createSessionAdapter({
      roles: "roles",
      subjectId: "id",
    });
    expect(
      adapt({
        id: "u",
      }),
    ).toEqual({
      context: {},
      subject: {
        id: "u",
      },
    });
  });

  it("requires a usable subject id", () => {
    const adapt = createSessionAdapter({
      subjectId: "user.id",
    });
    for (const bad of [
      undefined,
      null,
      {},
      {
        user: {},
      },
      {
        user: {
          id: "",
        },
      },
    ]) {
      expect(() => adapt(bad)).toThrow(AdapterMappingError);
    }
  });

  it("fails loudly when a configured tenant id is missing", () => {
    const adapt = createSessionAdapter({
      subjectId: "id",
      tenantId: "org.id",
    });
    expect(() =>
      adapt({
        id: "u",
      }),
    ).toThrow(AdapterMappingError);
  });

  it("rejects roles in the wrong shape", () => {
    const adapt = createSessionAdapter({
      roles: "roles",
      subjectId: "id",
    });
    expect(() =>
      adapt({
        id: "u",
        roles: "admin",
      }),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt({
        id: "u",
        roles: [
          {},
        ],
      }),
    ).toThrow(AdapterMappingError);
    const withKey = createSessionAdapter({
      roleKey: "name",
      roles: "roles",
      subjectId: "id",
    });
    expect(() =>
      withKey({
        id: "u",
        roles: [
          {
            name: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    ).toThrow(AdapterMappingError);
  });

  it("never puts response values in error messages", () => {
    const adapt = createSessionAdapter({
      roles: "roles",
      subjectId: "id",
    });
    try {
      adapt({
        id: "u",
        roles: "super-secret-token",
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-token");
    }
  });

  it("does not read inherited properties", () => {
    const adapt = createSessionAdapter({
      subjectId: "toString",
    });
    expect(() => adapt({})).toThrow(AdapterMappingError);
  });

  it("rejects invalid configuration up front", () => {
    const create = (mapping: unknown) => () =>
      createSessionAdapter(mapping as never);
    expect(create(undefined)).toThrow(AdapterMappingError);
    expect(create({})).toThrow(AdapterMappingError);
    expect(
      create({
        subjectId: "",
      }),
    ).toThrow(AdapterMappingError);
    expect(
      create({
        subjectId: "a..b",
      }),
    ).toThrow(AdapterMappingError);
    expect(
      create({
        subjectId: "__proto__.id",
      }),
    ).toThrow(AdapterMappingError);
    expect(
      create({
        attributes: {
          a: "constructor.x",
        },
        subjectId: "id",
      }),
    ).toThrow(AdapterMappingError);
    expect(
      create({
        attributes: "x",
        subjectId: "id",
      }),
    ).toThrow(AdapterMappingError);
  });
});
