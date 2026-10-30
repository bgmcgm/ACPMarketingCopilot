import {
  CreateClientRequestSchema,
  SelectGoogleLocationRequestSchema,
  type ClientDto,
  type GoogleAuthorizeResponse,
  type GoogleCallbackResponse,
  type ListClientsResponse,
} from "@mcopilot/shared-types";
import type { Principal } from "../auth/principal.js";
import type { ClientDocument } from "../domain/clientDocument.js";
import type { ClientRepository } from "../persistence/ports.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  type GoogleOAuthConfig,
} from "../connectors/googleBusinessProfile/oauth.js";
import { signState, verifyState } from "../connectors/googleBusinessProfile/state.js";
import type { GoogleBusinessProfileClient } from "../connectors/googleBusinessProfile/client.js";
import { encryptToken } from "../lib/tokenCipher.js";
import { ApiError, clientNotFound } from "./errors.js";

export interface ClientServiceDeps {
  repo: ClientRepository;
  google: GoogleBusinessProfileClient;
  oauth: GoogleOAuthConfig;
  stateSecret: string;
  tokenEncryptionKey: string;
  now?: () => Date;
  newId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClientService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: ClientServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? (() => crypto.randomUUID());
  }

  async create(principal: Principal, body: unknown): Promise<ClientDto> {
    const req = CreateClientRequestSchema.parse(body);
    const doc: ClientDocument = {
      id: this.newId(),
      ownerId: principal.userId,
      type: "client",
      schemaVersion: 1,
      name: req.name,
      category: req.category,
      createdAt: this.now().toISOString(),
    };
    await this.d.repo.create(doc);
    return toDto(doc);
  }

  async list(principal: Principal): Promise<ListClientsResponse> {
    const docs = await this.d.repo.list(principal.userId);
    return { items: docs.map(toDto) };
  }

  async getAuthorizeUrl(principal: Principal, clientId: string): Promise<GoogleAuthorizeResponse> {
    await this.load(principal, clientId);
    const state = signState({ clientId, ownerId: principal.userId }, this.d.stateSecret, this.now);
    return { authorizeUrl: buildAuthorizeUrl(this.d.oauth, state) };
  }

  async handleGoogleCallback(
    principal: Principal,
    query: { code: string; state: string },
  ): Promise<GoogleCallbackResponse> {
    let statePayload: { clientId: string; ownerId: string };
    try {
      statePayload = verifyState(query.state, this.d.stateSecret, { now: this.now });
    } catch {
      throw new ApiError(400, "INVALID_STATE", "Der OAuth-Vorgang ist ungültig oder abgelaufen.");
    }
    if (statePayload.ownerId !== principal.userId) {
      throw new ApiError(403, "FORBIDDEN", "state gehört zu einem anderen Benutzer.");
    }
    const client = await this.load(principal, statePayload.clientId);

    const tokens = await exchangeCodeForTokens(this.d.oauth, query.code);
    if (!tokens.refreshToken) {
      throw new ApiError(
        502,
        "NO_REFRESH_TOKEN",
        "Google hat kein Refresh-Token geliefert. Bitte Verbindung erneut starten.",
      );
    }

    const accounts = await this.d.google.listAccounts(tokens.accessToken);
    const locations = (
      await Promise.all(
        accounts.map((a) => this.d.google.listLocations(tokens.accessToken, a.accountName)),
      )
    ).flat();

    const updated: ClientDocument = {
      ...client,
      pendingGoogleAuth: {
        encryptedRefreshToken: encryptToken(tokens.refreshToken, this.d.tokenEncryptionKey),
        locations,
        createdAt: this.now().toISOString(),
      },
    };
    const saved = await this.d.repo.claim(updated);
    if (!saved) {
      throw new ApiError(
        409,
        "CONFLICT",
        "Kunde wurde zwischenzeitlich geändert, bitte erneut versuchen.",
      );
    }
    return { clientId: client.id, locations };
  }

  async selectGoogleLocation(
    principal: Principal,
    clientId: string,
    body: unknown,
  ): Promise<ClientDto> {
    const req = SelectGoogleLocationRequestSchema.parse(body);
    const client = await this.load(principal, clientId);
    const pending = client.pendingGoogleAuth;
    if (!pending) {
      throw new ApiError(
        409,
        "NO_PENDING_AUTH",
        "Kein offener Google-Verbindungsvorgang für diesen Kunden.",
      );
    }
    const location = pending.locations.find((l) => l.locationName === req.locationName);
    if (!location) {
      throw new ApiError(400, "VALIDATION_ERROR", "Unbekannter Standort.");
    }
    const updated: ClientDocument = {
      ...client,
      googleAccount: {
        status: "connected",
        locationName: location.locationName,
        displayName: location.displayName,
        connectedAt: this.now().toISOString(),
        encryptedRefreshToken: pending.encryptedRefreshToken,
      },
    };
    delete updated.pendingGoogleAuth;
    const saved = await this.d.repo.claim(updated);
    if (!saved) {
      throw new ApiError(
        409,
        "CONFLICT",
        "Kunde wurde zwischenzeitlich geändert, bitte erneut versuchen.",
      );
    }
    return toDto(saved);
  }

  private async load(principal: Principal, clientId: string): Promise<ClientDocument> {
    if (!UUID.test(clientId)) throw clientNotFound();
    const doc = await this.d.repo.get(principal.userId, clientId);
    if (!doc) throw clientNotFound();
    return doc;
  }
}

function toDto(doc: ClientDocument): ClientDto {
  return {
    id: doc.id,
    name: doc.name,
    category: doc.category,
    createdAt: doc.createdAt,
    ...(doc.googleAccount
      ? {
          googleAccount: {
            status: doc.googleAccount.status,
            locationName: doc.googleAccount.locationName,
            displayName: doc.googleAccount.displayName,
            connectedAt: doc.googleAccount.connectedAt,
            ...(doc.googleAccount.lastSyncAt ? { lastSyncAt: doc.googleAccount.lastSyncAt } : {}),
          },
        }
      : {}),
    ...(doc.pendingGoogleAuth ? { pendingGoogleLocations: doc.pendingGoogleAuth.locations } : {}),
  };
}
