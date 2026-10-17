import { AdapterMappingError } from "@useguardril/core";
import { describe, expect, it } from "vitest";
import {
  createTuplesAdapter,
  openFgaTuplesAdapter,
  spiceDbTuplesAdapter,
} from "../../src/index.js";

describe("createTuplesAdapter", () => {
  const adapt = createTuplesAdapter({
    list: "grants",
    object: "resource",
    relation: "role",
    subject: "principal",
  });

  it("maps records through configurable paths", () => {
    expect(
      adapt({
        grants: [
          {
            principal: "user:ana",
            resource: "doc:1",
            role: "viewer",
          },
        ],
      }),
    ).toEqual([
      {
        object: "doc:1",
        relation: "viewer",
        subject: "user:ana",
      },
    ]);
  });

  it("rejects missing lists and incomplete records without leaking values", () => {
    expect(() => adapt({})).toThrow(AdapterMappingError);
    expect(() =>
      adapt({
        grants: [
          {
            resource: "doc:1",
            role: "viewer",
          },
        ],
      }),
    ).toThrow(AdapterMappingError);
    try {
      adapt({
        grants: [
          {
            principal: "secret-principal",
            resource: "",
            role: "r",
          },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-principal");
    }
  });
});

describe("openFgaTuplesAdapter", () => {
  it("maps an OpenFGA Read response, keeping usersets", () => {
    expect(
      openFgaTuplesAdapter({
        continuation_token: "",
        tuples: [
          {
            key: {
              object: "document:budget",
              relation: "reader",
              user: "user:anne",
            },
          },
          {
            key: {
              object: "document:budget",
              relation: "writer",
              user: "team:eng#member",
            },
          },
        ],
      }),
    ).toEqual([
      {
        object: "document:budget",
        relation: "reader",
        subject: "user:anne",
      },
      {
        object: "document:budget",
        relation: "writer",
        subject: "team:eng#member",
      },
    ]);
  });

  it("rejects unexpected shapes", () => {
    expect(() =>
      openFgaTuplesAdapter({
        tuples: [
          {
            key: {},
          },
        ],
      }),
    ).toThrow(AdapterMappingError);
    expect(() => openFgaTuplesAdapter([])).toThrow(AdapterMappingError);
  });
});

describe("spiceDbTuplesAdapter", () => {
  const relationship = {
    relation: "viewer",
    resource: {
      objectId: "1",
      objectType: "document",
    },
    subject: {
      object: {
        objectId: "ana",
        objectType: "user",
      },
    },
  };

  it("maps an array, a wrapped list, and streamed results", () => {
    const expected = [
      {
        object: "document:1",
        relation: "viewer",
        subject: "user:ana",
      },
    ];
    expect(
      spiceDbTuplesAdapter([
        {
          relationship,
        },
      ]),
    ).toEqual(expected);
    expect(
      spiceDbTuplesAdapter({
        relationships: [
          {
            relationship,
          },
        ],
      }),
    ).toEqual(expected);
    expect(
      spiceDbTuplesAdapter([
        {
          result: {
            relationship,
          },
        },
      ]),
    ).toEqual(expected);
  });

  it("appends optionalRelation for usersets and ignores an empty one", () => {
    const withUserset = {
      ...relationship,
      subject: {
        object: {
          objectId: "eng",
          objectType: "team",
        },
        optionalRelation: "member",
      },
    };
    const emptyRelation = {
      ...relationship,
      subject: {
        ...relationship.subject,
        optionalRelation: "",
      },
    };
    expect(
      spiceDbTuplesAdapter([
        {
          relationship: withUserset,
        },
      ])[0]?.subject,
    ).toBe("team:eng#member");
    expect(
      spiceDbTuplesAdapter([
        {
          relationship: emptyRelation,
        },
      ])[0]?.subject,
    ).toBe("user:ana");
  });

  it("rejects malformed records", () => {
    expect(() =>
      spiceDbTuplesAdapter([
        {},
      ]),
    ).toThrow(AdapterMappingError);
    expect(() =>
      spiceDbTuplesAdapter([
        {
          relationship: {
            ...relationship,
            resource: {},
          },
        },
      ]),
    ).toThrow(AdapterMappingError);
    expect(() => spiceDbTuplesAdapter("nope")).toThrow(AdapterMappingError);
  });
});
