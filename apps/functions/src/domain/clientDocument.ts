import type { ClientCategory } from "@mcopilot/shared-types";

/** Cosmos-Dokument eines Agentur-Kunden (Partition Key: ownerId). */
export interface ClientDocument {
  id: string;
  ownerId: string;
  type: "client";
  /** Systemfeld von Cosmos (optimistische Sperre); nicht selbst setzen. */
  _etag?: string;
  schemaVersion: 1;
  name: string;
  category: ClientCategory;
  createdAt: string;
  googleAccount?: {
    status: "connected" | "error";
    locationName: string;
    displayName: string;
    connectedAt: string;
    lastSyncAt?: string;
    /** AES-256-GCM, Base64 (iv + ciphertext + authTag). Nie im Klartext persistieren. */
    encryptedRefreshToken: string;
  };
  /**
   * Zwischenzustand nach dem OAuth-Callback, solange der Standort noch nicht ausgewählt wurde
   * (Kunde kann mehrere Google-Business-Standorte haben). Refresh-Token ist bereits verschlüsselt,
   * damit er zu keinem Zeitpunkt im Klartext persistiert wird.
   */
  pendingGoogleAuth?: {
    encryptedRefreshToken: string;
    locations: { locationName: string; displayName: string }[];
    createdAt: string;
  };
}
