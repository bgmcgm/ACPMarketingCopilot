export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (): ApiError => new ApiError(404, "NOT_FOUND", "Audit nicht gefunden.");
