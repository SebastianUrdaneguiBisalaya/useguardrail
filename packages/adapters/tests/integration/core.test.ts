import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
} from "@useguardril/core";
import { describe, expect, it } from "vitest";
import {
  createRolesAdapter,
  createSessionAdapter,
  openFgaTuplesAdapter,
  spiceDbTuplesAdapter,
} from "../../src/index.js";

describe("adapters + core integration", () => {
  it("feeds backend responses into a working RBAC store", () => {
    const adaptRoles = createRolesAdapter({
      list: "roles",
      name: "name",
      permissions: "permissions",
    });
    const adaptSession = createSessionAdapter({
      roleKey: "name",
      roles: "user.roles",
      subjectId: "user.id",
      tenantId: "tenant",
    });

    const engine = createEngine({
      evaluators: [
        createRbacEvaluator({
          roles: adaptRoles({
            roles: [
              {
                name: "editor",
                permissions: [
                  "invoice:update",
                ],
              },
            ],
          }),
        }),
      ],
    });
    const { context, subject } = adaptSession({
      tenant: "acme",
      user: {
        id: 1,
        roles: [
          {
            name: "editor",
          },
        ],
      },
    });
    const store = createAuthorizationStore({
      context,
      engine,
      subject,
    });

    expect(
      store.can("update", {
        id: "1",
        type: "invoice",
      }),
    ).toBe(true);
    expect(
      store.can("delete", {
        id: "1",
        type: "invoice",
      }),
    ).toBe(false);
  });

  it("feeds OpenFGA and SpiceDB tuples into the relation graph", () => {
    const fromOpenFga = createRelationGraph({
      tuples: openFgaTuplesAdapter({
        tuples: [
          {
            key: {
              object: "document:1",
              relation: "viewer",
              user: "team:eng#member",
            },
          },
          {
            key: {
              object: "team:eng",
              relation: "member",
              user: "user:ana",
            },
          },
        ],
      }),
    });
    expect(fromOpenFga.check("user:ana", "viewer", "document:1")).toBe(true);

    const fromSpiceDb = createRelationGraph({
      tuples: spiceDbTuplesAdapter([
        {
          relationship: {
            relation: "viewer",
            resource: {
              objectId: "1",
              objectType: "document",
            },
            subject: {
              object: {
                objectId: "eng",
                objectType: "team",
              },
              optionalRelation: "member",
            },
          },
        },
        {
          relationship: {
            relation: "member",
            resource: {
              objectId: "eng",
              objectType: "team",
            },
            subject: {
              object: {
                objectId: "ana",
                objectType: "user",
              },
            },
          },
        },
      ]),
    });
    const rebac = createRebacEvaluator({
      graph: fromSpiceDb,
      requirements: {
        document: {
          read: "viewer",
        },
      },
    });
    const decision = createEngine({
      evaluators: [
        rebac,
      ],
    }).evaluate({
      action: "read",
      context: {},
      resource: {
        id: "1",
        type: "document",
      },
      subject: {
        id: "user:ana",
      },
    });
    expect(decision.effect).toBe("allow");
  });
});
