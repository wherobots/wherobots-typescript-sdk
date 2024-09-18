import { RETRYABLE_HTTP_STATUS_CODES } from "@/api-utils";
import { SessionStatus } from "@/constants";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { FetchMock } from "vitest-fetch-mock";

const createMockSessionPayload = (status: SessionStatus): string =>
  JSON.stringify({
    id: "test-session-id",
    status: status,
    appMeta: {
      url: "htttp://test-session-url",
    },
    traces: null,
    message: null,
  });

export const simulateImmediatelyReadySession = (fetchMock: FetchMock) =>
  fetchMock.mockResponse(createMockSessionPayload(SessionStatus.READY));

export const SESSION_LIFECYCLE_RESPONSES = [
  createMockSessionPayload(SessionStatus.PENDING),
  createMockSessionPayload(SessionStatus.PENDING),
  createMockSessionPayload(SessionStatus.PREPARING),
  createMockSessionPayload(SessionStatus.REQUESTED),
  createMockSessionPayload(SessionStatus.REQUESTED),
  createMockSessionPayload(SessionStatus.DEPLOYING),
  createMockSessionPayload(SessionStatus.DEPLOYED),
  createMockSessionPayload(SessionStatus.INITIALIZING),
  createMockSessionPayload(SessionStatus.INITIALIZING),
  createMockSessionPayload(SessionStatus.INITIALIZING),
  createMockSessionPayload(SessionStatus.READY),
];

export const simulateSessionCreationLifecycle = (fetchMock: FetchMock) => {
  fetchMock.mockResponses(...SESSION_LIFECYCLE_RESPONSES);
};

export const simulateSessionCreateUnauthenticated = (fetchMock: FetchMock) => {
  fetchMock.mockResponse("Not authorized", { status: 401 });
};

export const simulateSessionCreateTransientNetworkError = (
  fetchMock: FetchMock,
  options: { numInitialFailures: number },
) => {
  Array.from(Array(options.numInitialFailures)).forEach(() => {
    fetchMock.mockResponseOnce("Service Unavailable", {
      status: RETRYABLE_HTTP_STATUS_CODES[0]!,
    });
  });
  fetchMock.mockResponse(createMockSessionPayload(SessionStatus.READY));
};

export const simulateSessionCreateTimeout = (
  fetchMock: FetchMock,
  options: { numTimeouts: number },
) => {
  Array.from(Array(options.numTimeouts)).forEach(() => {
    // this is as close as we can get to simulating a timeout,
    // because we are replacing the fetch implementation and so the
    // abort signal we pass in is not actually used
    fetchMock.mockResponseOnce(() =>
      Promise.reject(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        new global.DOMException("The operation timed out.", "TimeoutError"),
      ),
    );
  });
  fetchMock.mockResponse(createMockSessionPayload(SessionStatus.READY));
};

const INVALID_SESSION_PAYLOAD = createMockSessionPayload(
  "invalid" as unknown as SessionStatus,
);

export const simulateSessionCreateInvalidResponse = (fetchMock: FetchMock) => {
  fetchMock.mockResponse(INVALID_SESSION_PAYLOAD);
};

export const simulateSessionServiceError = (
  fetchMock: FetchMock,
  options: { numInitialSuccesses: number },
) => {
  fetchMock.mockResponses(
    ...Array.from(Array(options.numInitialSuccesses)).map(() =>
      createMockSessionPayload(SessionStatus.PENDING),
    ),
    ["Server error", { status: 500 }],
  );
};

export const simulateSessionPollInvalidResponse = (
  fetchMock: FetchMock,
  options: { numInitialSuccesses: number },
) => {
  fetchMock.mockResponses(
    ...Array.from(Array(options.numInitialSuccesses)).map(() =>
      createMockSessionPayload(SessionStatus.PENDING),
    ),
    INVALID_SESSION_PAYLOAD,
  );
};

export const simulateSessionPollTransientNetworkError = (
  fetchMock: FetchMock,
  options: { numFailures: number },
) => {
  fetchMock.mockResponses(...SESSION_LIFECYCLE_RESPONSES.slice(-1));
  Array.from(Array(options.numFailures)).forEach(() => {
    fetchMock.mockResponseOnce("Service Unavailable", {
      status: RETRYABLE_HTTP_STATUS_CODES[0]!,
    });
  });
  fetchMock.mockResponse(createMockSessionPayload(SessionStatus.READY));
};
