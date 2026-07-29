import z from "zod";
import { MAX_HEADER_BYTES } from "./clientHeader";
import {
  DataCompression,
  GeometryRepresentation,
  ResultsFormat,
  SessionStatus,
  SessionType,
} from "./constants";

//////////////////////////////////////////////////////////////////////////
// Schema-definitions for connection options from the consumer

// A schema for the options that are passed to the Connection contstructor,
// used to generate the typescript type for that constructor

const apiKeySchema = z.string().min(1).max(255);

const ConnectionOptionsSchema = z.object({
  apiKey: apiKeySchema.optional(),
  // A bearer token (e.g. a WorkOS access token) used instead of an API key.
  // Exactly one of `token` / `apiKey` must be provided. In the browser, prefer
  // `token`: it authenticates the REST calls, while the session WebSocket relies
  // on the ambient `wherobotsToken` cookie.
  token: z.string().min(1).max(8192).optional(),
  // Override the API origin. Defaults to the WHEROBOTS_API_URL env var (Node)
  // or https://api.cloud.wherobots.com. Must be set explicitly in the browser
  // only when targeting a non-default environment.
  apiUrl: z.string().url().optional(),
  // Accepts any non-empty string; `Runtime` enum values are passed through as-is.
  // When omitted, the org's default runtime is used.
  runtime: z
    .string()
    .min(1)
    .describe(
      "Override the default runtime set for your organization. Only set this if you need a specific runtime instead of the one your administrator has configured. When omitted, your organization's default runtime is used.",
    )
    .optional(),
  // Accepts any non-empty string; `Region` enum values and BYOC region
  // identifiers (e.g. "byoc-acme-us-east-1") are passed through as-is.
  // When omitted, the org's default region is used.
  region: z
    .string()
    .min(1)
    .describe(
      "Override the default region set for your organization. Only set this if you intend to use a specific region instead of the one your administrator has configured. When omitted, your organization's default region is used.",
    )
    .optional(),
  version: z.string().nullable().optional(),
  resultsFormat: z.literal(ResultsFormat.ARROW).optional(),
  // Result compression to request from the server. When omitted, the platform
  // default is used (brotli in Node, gzip in the browser).
  dataCompression: z.nativeEnum(DataCompression).optional(),
  geometryRepresentation: z.nativeEnum(GeometryRepresentation).optional(),
  sessionType: z.nativeEnum(SessionType).optional(),
  forceNew: z.boolean().optional(),
  shutdownAfterInactiveSeconds: z.number().int().positive().optional(),
  // An inbound `X-Wherobots-Client` chain to forward. Set this only when the
  // caller is itself acting on behalf of an upstream Wherobots client (an app
  // embedding this SDK, a BI integration); the value is sanitized and kept to
  // the left of this SDK's own hop, so the origin stays leftmost. Attribution
  // is advisory and never affects auth, so a malformed value costs provenance,
  // not the request. The bound here is a coarse guard measured in UTF-16 code
  // units, not bytes; `clientHeaderValue` enforces the real UTF-8 byte budget.
  clientChain: z.string().min(1).max(MAX_HEADER_BYTES).optional(),
});

export type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>;

// A normalized extension to the ConnectionOptionsSchema that fills in defaults
// for all optional fields. `apiKey`/`token` stay optional here; exactly one is
// required, enforced by the refinement below. `dataCompression` stays optional
// so the connection can fall back to the platform default.
export const ConnectionOptionsSchemaNormalized = ConnectionOptionsSchema.extend(
  {
    // No region/runtime default: when the consumer omits them they stay
    // undefined and are dropped from the request so the API applies the
    // organization's configured defaults.
    resultsFormat: ConnectionOptionsSchema.shape.resultsFormat.default(
      ResultsFormat.ARROW,
    ),
    geometryRepresentation:
      ConnectionOptionsSchema.shape.geometryRepresentation.default(
        GeometryRepresentation.EWKT,
      ),
    sessionType: ConnectionOptionsSchema.shape.sessionType.default(
      SessionType.SINGLE,
    ),
    forceNew: ConnectionOptionsSchema.shape.forceNew.default(false),
  },
).superRefine((options, ctx) => {
  if (Boolean(options.token) === Boolean(options.apiKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one of `token` or `apiKey` is required",
    });
  }
});

export type ConnectionOptionsNormalized = z.infer<
  typeof ConnectionOptionsSchemaNormalized
>;

//////////////////////////////////////////////////////////////////////////
// Schema-definitions for creating the session via REST

const AppMetaSchema = z.object({
  url: z.string().url(),
});

export const SessionResponseSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(SessionStatus),
  appMeta: AppMetaSchema.nullable().optional(),
  traces: z.object({}).passthrough().nullable().optional(),
  message: z.string().nullable().optional(),
});

export type SessionReponse = z.infer<typeof SessionResponseSchema>;

export const ReadySessionResponseSchema = SessionResponseSchema.extend({
  status: z.literal(SessionStatus.READY),
  appMeta: AppMetaSchema,
});

//////////////////////////////////////////////////////////////////////////
// Schema-definitions for executing SQL over web socket

const ExecutionIdSchema = z.string().min(1).max(255);

export const ExecuteSQLEventSchema = z.object({
  kind: z.literal("execute_sql"),
  execution_id: ExecutionIdSchema,
  statement: z.string().min(1),
});

export type ExecuteSQLEvent = z.infer<typeof ExecuteSQLEventSchema>;

export const RetrieveResultsEventSchema = z.object({
  kind: z.literal("retrieve_results"),
  execution_id: ExecutionIdSchema,
  geometry: z.nativeEnum(GeometryRepresentation),
  compression: z.nativeEnum(DataCompression),
});

export type RetrieveResultsEvent = z.infer<typeof RetrieveResultsEventSchema>;

export const CancelExecutionEventSchema = z.object({
  kind: z.literal("cancel"),
  execution_id: ExecutionIdSchema,
});

export type CancelExecutionEvent = z.infer<typeof CancelExecutionEventSchema>;

export const EventWithExecutionIdSchema = z.object({
  execution_id: ExecutionIdSchema,
});

export const StateUpdatedEventSchema = EventWithExecutionIdSchema.extend({
  kind: z.literal("state_updated"),
  state: z.literal("succeeded"),
});

export type StateUpdatedEvent = z.infer<typeof StateUpdatedEventSchema>;

export const ExecutionResultEventSchema = EventWithExecutionIdSchema.extend({
  kind: z.literal("execution_result"),
  state: z.literal("succeeded"),
  results: z.object({
    // Binary frames decode to a Uint8Array. Using z.custom (rather than
    // z.instanceof) keeps the inferred type the permissive `Uint8Array` so a
    // Node Buffer (Uint8Array<ArrayBufferLike>) is accepted as well.
    result_bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, {
      message: "Expected binary result bytes",
    }),
    compression: z.nativeEnum(DataCompression),
    format: z.nativeEnum(ResultsFormat),
    geometry: z.nativeEnum(GeometryRepresentation),
    geo_columns: z.array(z.string()),
  }),
});

export type ExecutionResultEvent = z.infer<typeof ExecutionResultEventSchema>;

export const ErrorEventSchema = EventWithExecutionIdSchema.extend({
  kind: z.literal("error"),
  message: z.string(),
});

export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
