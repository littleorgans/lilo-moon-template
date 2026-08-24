/**
 * A client method the calling test file does not exercise.
 *
 * `WorkOSClient` is structural, so every double must satisfy the whole surface even when a file
 * cares about two methods. Throwing rather than returning a stub value keeps an unexpected call
 * visible instead of letting it pass as a silent success.
 */
export const notUnderTest = (): never => {
  throw new Error("this client method is not part of these tests");
};
