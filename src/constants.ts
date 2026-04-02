export enum Region {
  // Americas
  AWS_US_EAST_1 = "aws-us-east-1",
  AWS_US_EAST_2 = "aws-us-east-2",
  AWS_US_WEST_2 = "aws-us-west-2",

  // EMEA
  AWS_EU_WEST_1 = "aws-eu-west-1",

  // APAC
  AWS_AP_SOUTH_1 = "aws-ap-south-1",
}

export enum Runtime {
  TINY = "tiny",
  SMALL = "small",
  MEDIUM = "medium",
  LARGE = "large",
  X_LARGE = "x-large",
  XX_LARGE = "2x-large",
  XXXX_LARGE = "4x-large",

  MEDIUM_HIMEM = "medium-himem",
  LARGE_HIMEM = "large-himem",
  X_LARGE_HIMEM = "x-large-himem",
  XX_LARGE_HIMEM = "2x-large-himem",
  XXXX_LARGE_HIMEM = "4x-large-himem",

  TINY_A10_GPU = "tiny-a10-gpu",
  SMALL_A10_GPU = "small-a10-gpu",
  MEDIUM_A10_GPU = "medium-a10-gpu",
}

export enum ResultsFormat {
  JSON = "json",
  ARROW = "arrow",
}

export enum DataCompression {
  BROTLI = "brotli",
}

export enum GeometryRepresentation {
  WKT = "wkt",
  WKB = "wkb",
  EWKT = "ewkt",
  EWKB = "ewkb",
  GEOJSON = "geojson",
}

export enum SessionType {
  SINGLE = "single",
  MULTI = "multi",
}

export enum SessionStatus {
  PENDING = "PENDING",
  PREPARING = "PREPARING",
  PREPARE_FAILED = "PREPARE_FAILED",
  REQUESTED = "REQUESTED",
  DEPLOYING = "DEPLOYING",
  DEPLOY_FAILED = "DEPLOY_FAILED",
  DEPLOYED = "DEPLOYED",
  INITIALIZING = "INITIALIZING",
  INIT_FAILED = "INIT_FAILED",
  READY = "READY",
  DESTROY_REQUESTED = "DESTROY_REQUESTED",
  DESTROYING = "DESTROYING",
  DESTROY_FAILED = "DESTROY_FAILED",
  DESTROYED = "DESTROYED",
}
