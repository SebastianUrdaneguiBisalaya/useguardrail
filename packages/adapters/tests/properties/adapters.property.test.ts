import { AdapterMappingError } from "@useguardrail/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createRolesAdapter,
  createSessionAdapter,
  createTuplesAdapter,
  openFgaTuplesAdapter,
  spiceDbTuplesAdapter,
} from "../../src/index.js";

/** Runs an adapter and asserts it either returns or throws an AdapterMappingError, nothing else. */
const onlyAdapterErrors = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterMappingError);
  }
};

const session = createSessionAdapter({
  attributes: {
    dept: "user.dept",
  },
  contextAttributes: {
    plan: "org.plan",
  },
  roleKey: "name",
  roles: "user.roles",
  subjectId: "user.id",
  tenantId: "org.id",
});
const roles = createRolesAdapter({
  inherits: "parents",
  list: "roles",
  name: "name",
  permissions: "perms",
});
const tuples = createTuplesAdapter({
  list: "grants",
  object: "o",
  relation: "r",
  subject: "s",
});

describe("adapter properties", () => {
  it("never throw anything but AdapterMappingError, for any JSON input", () => {
    fc.assert(
      fc.property(fc.anything(), (response) => {
        onlyAdapterErrors(() => session(response));
        onlyAdapterErrors(() => roles(response));
        onlyAdapterErrors(() => tuples(response));
        onlyAdapterErrors(() => openFgaTuplesAdapter(response));
        onlyAdapterErrors(() => spiceDbTuplesAdapter(response));
      }),
      {
        numRuns: 500,
      },
    );
  });

  it("never throw anything but AdapterMappingError on near-valid input", () => {
    const value = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.array(fc.anything()),
    );
    fc.assert(
      fc.property(
        value,
        value,
        value,
        value,
        (id, tenant, rolesValue, tupleField) => {
          const response = {
            grants: [
              {
                o: tupleField,
                r: tupleField,
                s: tupleField,
              },
            ],
            org: {
              id: tenant,
            },
            roles: [
              {
                name: id,
                parents: rolesValue,
                perms: rolesValue,
              },
            ],
            user: {
              id,
              roles: rolesValue,
            },
          };
          onlyAdapterErrors(() => session(response));
          onlyAdapterErrors(() => roles(response));
          onlyAdapterErrors(() => tuples(response));
        },
      ),
      {
        numRuns: 300,
      },
    );
  });

  it("session output always has a non-empty string id and string roles", () => {
    fc.assert(
      fc.property(fc.anything(), (response) => {
        try {
          const { subject } = session(response);
          expect(typeof subject.id).toBe("string");
          expect(subject.id).not.toBe("");
          for (const role of subject.roles ?? []) {
            expect(typeof role).toBe("string");
          }
        } catch (error) {
          expect(error).toBeInstanceOf(AdapterMappingError);
        }
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("roles output never has a __proto__ key and every role has string permissions", () => {
    fc.assert(
      fc.property(fc.anything(), (response) => {
        try {
          const result = roles(response);
          expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
          expect(Object.hasOwn(result, "__proto__")).toBe(false);
          for (const definition of Object.values(result)) {
            expect(
              definition.permissions.every((p) => typeof p === "string"),
            ).toBe(true);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(AdapterMappingError);
        }
      }),
      {
        numRuns: 300,
      },
    );
  });
});
