export function isBrowser() {
  if (typeof window !== "undefined" && typeof window.document !== "undefined") {
    return true;
  } else {
    return false;
  }
}
