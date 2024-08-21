import { z } from "zod";
import {
  DataCompression,
  GeometryRepresentation,
  Region,
  ResultsFormat,
  Runtime,
} from "./constants";

export const ConnectionOptionsSchema = z.object({
  apiKey: z.string().min(1).max(255),
  runtime: z.nativeEnum(Runtime),
  region: z.nativeEnum(Region).optional(),
  resultsFormat: z.literal(ResultsFormat.ARROW).optional(),
  dataCompression: z.literal(DataCompression.BROTLI).optional(),
  geometryRepresentation: z.literal(GeometryRepresentation.EWKT).optional(),
});

type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>;

const connectionOptionDefaults = {
  region: Region.AWS_US_WEST_2 as const,
  resultsFormat: ResultsFormat.ARROW as const,
  dataCompression: DataCompression.BROTLI as const,
  geometryRepresentation: GeometryRepresentation.EWKT as const,
};

export class Connection {
  private options: Required<ConnectionOptions>;

  constructor(options: ConnectionOptions) {
    this.options = {
      ...connectionOptionDefaults,
      ...ConnectionOptionsSchema.parse(options),
    };
    console.log("Creating connection with...");
    console.log(JSON.stringify(this.options, null, 2));
  }

  public close(): void {
    console.log("Closing connection");
  }

  public [Symbol.dispose](): void {
    this.close();
  }
}
