import type {
  GoogleAccount,
  GoogleBusinessProfileClient,
  GoogleLocation,
  GoogleReview,
} from "../../apps/functions/src/connectors/googleBusinessProfile/client.js";
import type {
  ReviewReplyDraft,
  ReviewReplyInput,
  ReviewReplyProvider,
} from "../../apps/functions/src/ai/reviewReplyProvider.js";

export class FakeGoogleClient implements GoogleBusinessProfileClient {
  accounts: GoogleAccount[] = [{ accountName: "accounts/1", displayName: "Agentur" }];
  locationsByAccount: Record<string, GoogleLocation[]> = {
    "accounts/1": [{ locationName: "accounts/1/locations/2", displayName: "Café Sonnenschein" }],
  };
  reviewsByLocation: Record<string, GoogleReview[]> = {};
  repliedTo: { reviewName: string; comment: string }[] = [];
  replyShouldFail = false;

  async listAccounts(accessToken: string): Promise<GoogleAccount[]> {
    void accessToken;
    return this.accounts;
  }
  async listLocations(_accessToken: string, accountName: string): Promise<GoogleLocation[]> {
    return this.locationsByAccount[accountName] ?? [];
  }
  async listReviews(_accessToken: string, locationName: string): Promise<GoogleReview[]> {
    return this.reviewsByLocation[locationName] ?? [];
  }
  async replyToReview(_accessToken: string, reviewName: string, comment: string): Promise<void> {
    if (this.replyShouldFail) throw new Error("Google ist nicht erreichbar.");
    this.repliedTo.push({ reviewName, comment });
  }
}

export class FakeReviewReplyProvider implements ReviewReplyProvider {
  shouldFail = false;
  calls: ReviewReplyInput[] = [];

  async draftReply(input: ReviewReplyInput): Promise<ReviewReplyDraft> {
    this.calls.push(input);
    if (this.shouldFail) {
      return {
        meta: {
          status: "failed",
          model: "fake",
          promptVersion: "test",
          error: { code: "PROVIDER_ERROR", message: "KI nicht verfügbar." },
        },
      };
    }
    return {
      meta: {
        status: "completed",
        model: "fake",
        promptVersion: "test",
        generatedAt: "2026-10-30T12:00:00.000Z",
      },
      draftText: `Danke, ${input.review.reviewerDisplayName}!`,
    };
  }
}

/** Antwortet auf jeden Aufruf des Google-Token-Endpoints; genug für Service-Tests. */
export function stubGoogleTokenEndpoint(fetchMock: {
  mockImplementation: (fn: (url: string) => Promise<Response>) => void;
}): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token-1",
          refresh_token: "refresh-token-1",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unerwarteter fetch-Aufruf: ${url}`);
  });
}
