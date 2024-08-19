export enum Region {
  AWS_US_WEST_2 = "aws-us-west-2",
}

export enum Runtime {
  SEDONA = "TINY",
  SAN_FRANCISCO = "SMALL",
  NEW_YORK = "MEDIUM",
  CAIRO = "LARGE",
  DELHI = "XLARGE",
  TOKYO = "XXLARGE",
  ATLANTIS = "4x-large",

  NEW_YORK_HIMEM = "medium-himem",
  CAIRO_HIMEM = "large-himem",
  DELHI_HIMEM = "x-large-himem",
  TOKYO_HIMEM = "2x-large-himem",
  ATLANTIS_HIMEM = "4x-large-himem",

  SEDONA_GPU = "tiny-a10-gpu",
  SAN_FRANCISCO_GPU = "small-a10-gpu",
  NEW_YORK_GPU = "medium-a10-gpu",
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
