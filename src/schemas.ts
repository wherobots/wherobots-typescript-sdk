import z from "zod";
import {
  DataCompression,
  GeometryRepresentation,
  Region,
  ResultsFormat,
  Runtime,
  SessionStatus,
} from "./constants";

//////////////////////////////////////////////////////////////////////////
// Schema-definitions for connection options from the consumer

// A schema for the options that are passed to the Connection contstructor,
// used to generate the typescript type for that constructor
const ConnectionOptionsSchema = z.object({
  apiKey: z.string().min(1).max(255),
  runtime: z.nativeEnum(Runtime),
  region: z.nativeEnum(Region).optional(),
  resultsFormat: z.literal(ResultsFormat.ARROW).optional(),
  dataCompression: z.literal(DataCompression.BROTLI).optional(),
  geometryRepresentation: z.literal(GeometryRepresentation.EWKT).optional(),
});

export type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>;

// A normalized extension to the ConnectionOptionsSchema that fills in defaults
// for all optional fields
export const ConnectionOptionsSchemaNormalized = ConnectionOptionsSchema.extend(
  {
    region: ConnectionOptionsSchema.shape.region.default(Region.AWS_US_WEST_2),
    resultsFormat: ConnectionOptionsSchema.shape.resultsFormat.default(
      ResultsFormat.ARROW,
    ),
    dataCompression: ConnectionOptionsSchema.shape.dataCompression.default(
      DataCompression.BROTLI,
    ),
    geometryRepresentation:
      ConnectionOptionsSchema.shape.geometryRepresentation.default(
        GeometryRepresentation.EWKT,
      ),
  },
);

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
  traces: z.object({}).passthrough().nullable(),
  message: z.string().nullable(),
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
  geometry_representation: z.nativeEnum(GeometryRepresentation),
});

export type RetrieveResultsEvent = z.infer<typeof RetrieveResultsEventSchema>;

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
    result_bytes: z.instanceof(Buffer),
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
