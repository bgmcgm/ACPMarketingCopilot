import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "../../apps/functions/src/connectors/googleBusinessProfile/client.js";
import { HttpGoogleBusinessProfileClient } from "../../apps/functions/src/connectors/googleBusinessProfile/httpClient.js";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const client = new HttpGoogleBusinessProfileClient();

describe("HttpGoogleBusinessProfileClient", () => {
  it("lists accounts and sends the bearer token", async () => {
    fetchMock.mockResolvedValue(
      json(200, { accounts: [{ name: "accounts/1", accountName: "Agentur" }] }),
    );
    const accounts = await client.listAccounts("token-x");
    expect(accounts).toEqual([{ accountName: "accounts/1", displayName: "Agentur" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("mybusinessaccountmanagement.googleapis.com");
    expect(init.headers.authorization).toBe("Bearer token-x");
  });

  it("falls back to the resource name when accountName is missing", async () => {
    fetchMock.mockResolvedValue(json(200, { accounts: [{ name: "accounts/1" }] }));
    const accounts = await client.listAccounts("t");
    expect(accounts[0]).toEqual({ accountName: "accounts/1", displayName: "accounts/1" });
  });

  it("lists locations for an account", async () => {
    fetchMock.mockResolvedValue(
      json(200, { locations: [{ name: "accounts/1/locations/2", title: "Mein Geschäft" }] }),
    );
    const locations = await client.listLocations("t", "accounts/1");
    expect(locations).toEqual([
      { locationName: "accounts/1/locations/2", displayName: "Mein Geschäft" },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toContain("accounts/1/locations");
  });

  it("maps Google star-rating enums to numbers and handles missing fields", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        reviews: [
          {
            name: "accounts/1/locations/2/reviews/r1",
            reviewer: { displayName: "Maria" },
            starRating: "FOUR",
            comment: "Sehr nett.",
            createTime: "2026-01-01T00:00:00Z",
          },
          {
            name: "accounts/1/locations/2/reviews/r2",
            createTime: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    );
    const reviews = await client.listReviews("t", "accounts/1/locations/2");
    expect(reviews[0]).toMatchObject({
      externalReviewId: "accounts/1/locations/2/reviews/r1",
      reviewer: { displayName: "Maria" },
      starRating: 4,
      comment: "Sehr nett.",
    });
    expect(reviews[1]).toMatchObject({ reviewer: { displayName: "Unbekannt" }, comment: null });
  });

  it("posts a reply via PUT with a JSON body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await client.replyToReview("t", "accounts/1/locations/2/reviews/r1", "Danke!");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("reviews/r1/reply");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ comment: "Danke!" });
  });

  it.each([
    [401, "AUTH_EXPIRED"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_ERROR"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    const err = await client.listAccounts("t").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).code).toBe(code);
  });

  it("maps network failures to PROVIDER_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const err = await client.listAccounts("t").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).code).toBe("PROVIDER_ERROR");
  });
});
