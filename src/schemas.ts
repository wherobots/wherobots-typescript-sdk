import z from "zod";
import {
  DataCompression,
  GeometryRepresentation,
  Region,
  ResultsFormat,
  Runtime,
  SessionStatus,
} from "@/constants.js";

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

export const SessionResponseSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(SessionStatus),
  appMeta: z
    .object({
      url: z.string(),
    })
    .nullable()
    .optional(),
  traces: z.object({}).passthrough().nullable(),
  message: z.string().nullable(),
});

export type SessionReponse = z.infer<typeof SessionResponseSchema>;
