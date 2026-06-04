// Cross-platform environment access. A single guarded implementation works in
// both Node (reads process.env) and the browser (no process → undefined), so no
// platform-specific build is needed for this.
export const getEnv = (name: string): string | undefined => {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection
  return process.env[name];
};

export const isNode = (): boolean =>
  typeof process !== "undefined" && Boolean(process.versions?.node);
