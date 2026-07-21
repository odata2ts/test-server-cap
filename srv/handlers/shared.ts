import cds from "@sap/cds";

/**
 * The seven concrete media entity sets.
 *
 * The reference model has a single set `Media` over the abstract `Medium`, against which all
 * media-bound operations are declared once. Since CAP cannot express that (GAP G2), every
 * media-bound operation has to be registered once per concrete set.
 */
export const MEDIA_ENTITIES = [
  "Books",
  "Magazines",
  "TradeJournals",
  "Audiobooks",
  "DVDs",
  "EBooks",
  "CollectorsItems",
] as const;

export type MediaEntity = (typeof MEDIA_ENTITIES)[number];

/** Media sets that carry an `ISBN` element (reference model: `PrintMedium` and below). */
export const PRINT_MEDIA_ENTITIES: ReadonlyArray<MediaEntity> = ["Books", "Magazines", "TradeJournals"];

/**
 * The key of the entity a bound operation was invoked on, e.g. `Books(<guid>)/Service.LoanMetrics()`.
 * CAP exposes it as the last entry of `req.params`.
 */
export function boundKey(req: cds.Request): Record<string, unknown> {
  const params = req.params ?? [];
  const last = params[params.length - 1];
  return (typeof last === "object" && last !== null ? last : {}) as Record<string, unknown>;
}

/** The Guid identifying the medium a media-bound operation was invoked on. */
export function boundMediumId(req: cds.Request): string | undefined {
  return boundKey(req).Id as string | undefined;
}

/**
 * Formats a number of days as an ISO 8601 duration.
 *
 * Needed because no CDS type maps to `Edm.Duration`: the elements are declared as `String` with an
 * `@odata.Type` override, so the runtime has to produce spec-shaped literals itself.
 */
export function isoDuration(days: number): string {
  const whole = Math.max(0, Math.round(days));
  return `P${whole}D`;
}

/** Sums a numeric column, tolerating the `null` that SQLite returns for an empty set. */
export function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
