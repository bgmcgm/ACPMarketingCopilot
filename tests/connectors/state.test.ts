import { describe, expect, it } from "vitest";
import {
  OAuthStateError,
  signState,
  verifyState,
} from "../../apps/functions/src/connectors/googleBusinessProfile/state.js";

const payload = { clientId: "11111111-1111-4111-8111-111111111111", ownerId: "owner-1" };

describe("oauth state", () => {
  it("round-trips a signed state", () => {
    const state = signState(payload, "secret");
    expect(verifyState(state, "secret")).toEqual(payload);
  });

  it("rejects a state signed with a different secret", () => {
    const state = signState(payload, "secret-a");
    expect(() => verifyState(state, "secret-b")).toThrow(OAuthStateError);
  });

  it("rejects a tampered payload even with a valid-looking signature", () => {
    const state = signState(payload, "secret");
    const [encoded] = state.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, ownerId: "attacker" }),
      "utf8",
    ).toString("base64url");
    expect(() => verifyState(`${tamperedPayload}.${state.split(".")[1]}`, "secret")).toThrow(
      OAuthStateError,
    );
    expect(encoded).toBeDefined();
  });

  it("rejects malformed state strings", () => {
    expect(() => verifyState("not-a-valid-state", "secret")).toThrow(OAuthStateError);
    expect(() => verifyState("a.b.c", "secret")).toThrow(OAuthStateError);
  });

  it("rejects an expired state", () => {
    const now = () => new Date("2026-01-01T00:00:00Z");
    const state = signState(payload, "secret", now);
    const later = () => new Date("2026-01-01T00:11:00Z");
    expect(() => verifyState(state, "secret", { now: later, ttlMs: 10 * 60 * 1000 })).toThrow(
      OAuthStateError,
    );
  });

  it("accepts a state still within the TTL", () => {
    const now = () => new Date("2026-01-01T00:00:00Z");
    const state = signState(payload, "secret", now);
    const later = () => new Date("2026-01-01T00:09:00Z");
    expect(verifyState(state, "secret", { now: later, ttlMs: 10 * 60 * 1000 })).toEqual(payload);
  });
});
