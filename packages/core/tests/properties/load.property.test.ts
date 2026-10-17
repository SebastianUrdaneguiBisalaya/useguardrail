import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AuthorizationLoadResult } from "../../src/index.js";
import { createAuthorizationStore, createEngine } from "../../src/index.js";

const deferred = () => {
  let resolve!: (value: AuthorizationLoadResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<AuthorizationLoadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    reject,
    resolve,
  };
};

describe("store.load properties", () => {
  it("only the most recently started load can win, whatever order the loads settle in", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .integer({
            max: 5,
            min: 1,
          })
          .chain((count) =>
            fc.tuple(
              fc.array(fc.boolean(), {
                maxLength: count,
                minLength: count,
              }),
              fc.shuffledSubarray(
                Array.from(
                  {
                    length: count,
                  },
                  (_, index) => index,
                ),
                {
                  maxLength: count,
                  minLength: count,
                },
              ),
            ),
          ),
        async ([outcomes, settleOrder]) => {
          const store = createAuthorizationStore({
            engine: createEngine({
              evaluators: [],
            }),
            status: "loading",
          });
          const gates = outcomes.map(() => deferred());
          const runs = outcomes.map((_, index) =>
            store.load(
              () => (gates[index] as ReturnType<typeof deferred>).promise,
            ),
          );
          const last = outcomes.length - 1;

          for (const index of settleOrder) {
            const gate = gates[index] as ReturnType<typeof deferred>;
            if (outcomes[index]) {
              gate.resolve({
                subject: {
                  id: `u${index}`,
                },
              });
            } else {
              gate.reject(new Error(`load ${index} failed`));
            }
            await runs[index];

            // Until the last-started load settles, stale results must not leak in.
            if (
              index !== last &&
              !settleOrder
                .slice(0, settleOrder.indexOf(index) + 1)
                .includes(last)
            ) {
              expect(store.getSnapshot().status).toBe("loading");
              expect(store.getSnapshot().subject).toBeUndefined();
            }
          }
          await Promise.all(runs);

          const state = store.getSnapshot();
          if (outcomes[last]) {
            expect(state.status).toBe("ready");
            expect(state.subject?.id).toBe(`u${last}`);
          } else {
            expect(state.status).toBe("error");
          }
        },
      ),
      {
        numRuns: 100,
      },
    );
  });
});
