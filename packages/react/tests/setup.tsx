import type { Context, Subject } from "@useguardril/core";
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
} from "@useguardril/core";

const rbac = createRbacEvaluator({
  roles: {
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
  },
});

export const engine = createEngine({
  evaluators: [
    rbac,
  ],
});

export const createTestStore = (
  subject: Subject | undefined = {
    id: "user:ana",
    roles: [
      "viewer",
    ],
  },
  context: Context = {
    tenantId: "acme",
  },
) =>
  subject === undefined
    ? createAuthorizationStore({
        context,
        engine,
      })
    : createAuthorizationStore({
        context,
        engine,
        subject,
      });
