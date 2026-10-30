import type { StarRating } from "@mcopilot/shared-types";
import {
  GoogleApiError,
  type GoogleAccount,
  type GoogleBusinessProfileClient,
  type GoogleLocation,
  type GoogleReview,
} from "./client.js";

/**
 * [ANNAHME] Endpunkte/Feldformen Stand Oktober 2026 (Account Management API, Business Information
 * API, Reviews über die v4-"My Business"-API). Google hat diese APIs in der Vergangenheit mehrfach
 * aufgeteilt/umbenannt — vor dem ersten echten Aufruf gegen die aktuelle Dokumentation und ein
 * echtes Testkonto verifizieren (siehe ARCHITECTURE.md B6, docs/known-gaps.md).
 */
const ACCOUNTS_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

const STAR_RATING_MAP: Record<string, StarRating | undefined> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

async function googleFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new GoogleApiError("PROVIDER_ERROR", "Google-API nicht erreichbar.", { cause: err });
  }
  if (res.status === 401)
    throw new GoogleApiError("AUTH_EXPIRED", "Google-Zugriffstoken abgelaufen.");
  if (res.status === 404) throw new GoogleApiError("NOT_FOUND", "Google-Ressource nicht gefunden.");
  if (res.status === 429) throw new GoogleApiError("RATE_LIMITED", "Google-API-Limit erreicht.");
  if (!res.ok) {
    throw new GoogleApiError("PROVIDER_ERROR", `Google-API antwortete mit HTTP ${res.status}.`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface AccountsListResponse {
  accounts?: { name: string; accountName?: string }[];
}
interface LocationsListResponse {
  locations?: { name: string; title?: string }[];
}
interface ReviewsListResponse {
  reviews?: {
    name: string;
    reviewer?: { displayName?: string };
    starRating?: string;
    comment?: string;
    createTime: string;
  }[];
}

export class HttpGoogleBusinessProfileClient implements GoogleBusinessProfileClient {
  async listAccounts(accessToken: string): Promise<GoogleAccount[]> {
    const data = await googleFetch<AccountsListResponse>(`${ACCOUNTS_BASE}/accounts`, accessToken);
    return (data.accounts ?? []).map((a) => ({
      accountName: a.name,
      displayName: a.accountName ?? a.name,
    }));
  }

  async listLocations(accessToken: string, accountName: string): Promise<GoogleLocation[]> {
    const url = `${BUSINESS_INFO_BASE}/${accountName}/locations?readMask=name,title`;
    const data = await googleFetch<LocationsListResponse>(url, accessToken);
    return (data.locations ?? []).map((l) => ({
      locationName: l.name,
      displayName: l.title ?? l.name,
    }));
  }

  async listReviews(accessToken: string, locationName: string): Promise<GoogleReview[]> {
    const data = await googleFetch<ReviewsListResponse>(
      `${REVIEWS_BASE}/${locationName}/reviews`,
      accessToken,
    );
    return (data.reviews ?? []).map((r) => ({
      externalReviewId: r.name,
      reviewer: { displayName: r.reviewer?.displayName ?? "Unbekannt" },
      starRating: STAR_RATING_MAP[r.starRating ?? ""] ?? 5,
      comment: r.comment ?? null,
      createTime: r.createTime,
    }));
  }

  async replyToReview(accessToken: string, reviewName: string, comment: string): Promise<void> {
    await googleFetch<unknown>(`${REVIEWS_BASE}/${reviewName}/reply`, accessToken, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment }),
    });
  }
}
