// Named imports (rather than a default import of the whole file) let the
// bundler tree-shake package.json down to just these two fields, instead of
// inlining the entire manifest (deps and all) into both builds.
import { name, version } from "../package.json";

export const PACKAGE_NAME: string = name;
export const PACKAGE_VERSION: string = version;
