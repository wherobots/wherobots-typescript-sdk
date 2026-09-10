# Changelog

## Unreleased

### Changed

- **Breaking (browser):** the session WebSocket no longer authenticates an API
  key via the `?token=` query param — the server-side channel is being removed
  (goproxy), and a key in the URL leaks into history/Referer/proxy logs. The
  browser socket now authenticates solely via the ambient `wherobotsToken`
  cookie, which the hosting app must establish separately. Passing `token`
  authenticates REST calls and does not create that cookie. Passing `apiKey`
  in the browser throws at connect time. Node
  behavior is unchanged (API keys still use the `X-API-Key` header).

## 0.11.0

### Added

- Browser support: the SDK now ships a dual Node/browser build and can run in the
  browser, authenticating the session WebSocket via the ambient cookie or an
  API key query param.

## 0.3.0

### Changed

- Updated naming conventions for Wherobots Runtimes, the following mappings can be used for migration:
  - `Runtime.SEDONA` -> `Runtime.TINY`
  - `Runtime.SAN_FRANCISCO` -> `Runtime.SMALL`
  - `Runtime.NEW_YORK` -> `Runtime.MEDIUM`
  - `Runtime.CAIRO` -> `Runtime.LARGE`
  - `Runtime.DELHI` -> `Runtime.X_LARGE`
  - `Runtime.TOKYO` -> `Runtime.XX_LARGE`
  - `Runtime.ATLANTIS` -> `Runtime.XXXX_LARGE`
  - `Runtime.NEW_YORK_HIMEM` -> `Runtime.MEDIUM_HIMEM`
  - `Runtime.CAIRO_HIMEM` -> `Runtime.LARGE_HIMEM`
  - `Runtime.DELHI_HIMEM` -> `Runtime.X_LARGE_HIMEM`
  - `Runtime.TOKYO_HIMEM` -> `Runtime.XX_LARGE_HIMEM`
  - `Runtime.ATLANTIS_HIMEM` -> `Runtime.XXXX_LARGE_HIMEM`
  - `Runtime.SEDONA_GPU` -> `Runtime.TINY_A10_GPU`
  - `Runtime.SAN_FRANCISCO_GPU` -> `Runtime.SMALL_A10_GPU`
  - `Runtime.NEW_YORK_GPU` -> `Runtime.MEDIUM_A10_GPU`
