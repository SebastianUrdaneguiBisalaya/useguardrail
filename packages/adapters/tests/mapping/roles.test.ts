import { AdapterMappingError } from "@useguardrail/core";
import { describe, expect, it } from "vitest";
import { createRolesAdapter } from "../../src/index.js";

const mapping = {
  inherits: "parents",
  list: "data.roles",
  name: "slug",
  permissions: "grants",
};

describe("createRolesAdapter", () => {
  it("maps a roles response into RBAC role definitions", () => {
    const adapt = createRolesAdapter(mapping);
    expect(
      adapt({
        data: {
          roles: [
            {
              grants: [
                "invoice:read",
              ],
              slug: "viewer",
            },
            {
              grants: [
                "invoice:update",
              ],
              parents: [
                "viewer",
              ],
              slug: "editor",
            },
          ],
        },
      }),
    ).toEqual({
      editor: {
        inherits: [
          "viewer",
        ],
        permissions: [
          "invoice:update",
        ],
      },
      viewer: {
        permissions: [
          "invoice:read",
        ],
      },
    });
  });

  it("accepts a top-level array when no list path is given", () => {
    const adapt = createRolesAdapter({
      name: "name",
      permissions: "perms",
    });
    expect(
      adapt([
        {
          name: "a",
          perms: [],
        },
      ]),
    ).toEqual({
      a: {
        permissions: [],
      },
    });
  });

  it("rejects malformed responses", () => {
    const adapt = createRolesAdapter(mapping);
    const roles = (list: unknown) => ({
      data: {
        roles: list,
      },
    });
    expect(() => adapt(undefined)).toThrow(AdapterMappingError);
    expect(() =>
      adapt({
        data: {},
      }),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            grants: [],
          },
        ]),
      ),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            slug: "a",
          },
        ]),
      ),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            grants: "x",
            slug: "a",
          },
        ]),
      ),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            grants: [
              {},
            ],
            slug: "a",
          },
        ]),
      ),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            grants: [],
            parents: "x",
            slug: "a",
          },
        ]),
      ),
    ).toThrow(AdapterMappingError);
    expect(() =>
      adapt(
        roles([
          {
            grants: [],
            slug: "a",
          },
          {
            grants: [],
            slug: "a",
          },
        ]),
      ),
    ).toThrow(/duplicate/);
  });

  it("rejects the __proto__ role name and keeps other prototype-like names as plain roles", () => {
    const adapt = createRolesAdapter({
      name: "name",
      permissions: "perms",
    });
    expect(() =>
      adapt([
        {
          name: "__proto__",
          perms: [
            "a:b",
          ],
        },
      ]),
    ).toThrow(AdapterMappingError);
    const result = adapt([
      {
        name: "constructor",
        perms: [
          "a:b",
        ],
      },
    ]);
    expect(Object.hasOwn(result, "constructor")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("rejects invalid configuration up front", () => {
    const create = (value: unknown) => () => createRolesAdapter(value as never);
    expect(create(undefined)).toThrow(AdapterMappingError);
    expect(
      create({
        name: "n",
      }),
    ).toThrow(AdapterMappingError);
    expect(
      create({
        list: "",
        name: "n",
        permissions: "p",
      }),
    ).toThrow(AdapterMappingError);
  });
});
