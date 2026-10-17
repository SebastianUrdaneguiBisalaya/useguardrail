import { AdapterMappingError } from "@useguardrail/core";
import { describe, expect, it } from "vitest";
import {
  createRolesAdapter,
  createSessionAdapter,
  createTuplesAdapter,
} from "../src/index.js";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterMappingError);
    const e = error as AdapterMappingError;
    return {
      code: e.code,
      params: e.params,
    };
  }
  throw new Error("expected a throw");
};

describe("adapter error codes", () => {
  it("tags configuration errors", () => {
    expect(
      codeOf(() =>
        createSessionAdapter({
          subjectId: "a..b",
        }),
      ),
    ).toEqual({
      code: "ADAPTER_PATH_INVALID",
      params: {
        option: "subjectId",
      },
    });
  });

  it("tags session errors with paths, never values", () => {
    const adapt = createSessionAdapter({
      roles: "roles",
      subjectId: "user.id",
      tenantId: "org.id",
    });
    expect(codeOf(() => adapt({}))).toEqual({
      code: "ADAPTER_SUBJECT_ID_MISSING",
      params: {
        path: "user.id",
      },
    });
    expect(
      codeOf(() =>
        adapt({
          user: {
            id: "u",
          },
        }),
      ),
    ).toEqual({
      code: "ADAPTER_TENANT_ID_MISSING",
      params: {
        path: "org.id",
      },
    });
    expect(
      codeOf(() =>
        adapt({
          org: {
            id: "o",
          },
          roles: "secret-token",
          user: {
            id: "u",
          },
        }),
      ),
    ).toEqual({
      code: "ADAPTER_ROLES_NOT_ARRAY",
      params: {
        path: "roles",
      },
    });
  });

  it("tags roles errors with record positions", () => {
    const adapt = createRolesAdapter({
      name: "name",
      permissions: "perms",
    });
    expect(
      codeOf(() =>
        adapt([
          {
            perms: [],
          },
        ]),
      ),
    ).toEqual({
      code: "ADAPTER_ROLE_NAME_MISSING",
      params: {
        index: 0,
      },
    });
    expect(
      codeOf(() =>
        adapt([
          {
            name: "__proto__",
            perms: [],
          },
        ]),
      ).code,
    ).toBe("ADAPTER_ROLE_NAME_UNSAFE");
    expect(
      codeOf(() =>
        adapt([
          {
            name: "a",
            perms: [],
          },
          {
            name: "a",
            perms: [],
          },
        ]),
      ),
    ).toEqual({
      code: "ADAPTER_ROLE_DUPLICATE",
      params: {
        index: 1,
      },
    });
    expect(
      codeOf(() =>
        adapt([
          {
            name: "a",
          },
        ]),
      ),
    ).toEqual({
      code: "ADAPTER_PERMISSIONS_MISSING",
      params: {
        index: 0,
        path: "perms",
      },
    });
    expect(
      codeOf(() =>
        adapt([
          {
            name: "a",
            perms: "x",
          },
        ]),
      ),
    ).toEqual({
      code: "ADAPTER_STRING_LIST_INVALID",
      params: {
        field: "permissions",
        index: 0,
      },
    });
    expect(codeOf(() => adapt({}))).toEqual({
      code: "ADAPTER_LIST_NOT_ARRAY",
      params: {
        option: "roles",
      },
    });
  });

  it("tags tuple errors with the missing field and position", () => {
    const adapt = createTuplesAdapter({
      object: "o",
      relation: "r",
      subject: "s",
    });
    expect(
      codeOf(() =>
        adapt([
          {
            o: "doc:1",
            r: "viewer",
          },
        ]),
      ),
    ).toEqual({
      code: "ADAPTER_FIELD_MISSING",
      params: {
        field: "subject",
        index: 0,
      },
    });
  });
});
