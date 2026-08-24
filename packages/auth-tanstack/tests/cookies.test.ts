import { beforeEach, describe, expect, it, vi } from "vitest";

const getCookie = vi.fn<(name: string) => string | undefined>();
const setCookie = vi.fn();
const deleteCookie = vi.fn();

vi.mock("@tanstack/react-start/server", () => ({ getCookie, setCookie, deleteCookie }));

const { requestCookies } = await import("../src/cookies.js");

describe("requestCookies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads through to the request's cookies", () => {
    getCookie.mockReturnValue("sealed-value");
    expect(requestCookies.read("lilo_session")).toBe("sealed-value");
    expect(getCookie).toHaveBeenCalledWith("lilo_session");
  });

  it("passes write options through unchanged", () => {
    const options = {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    } as const;
    requestCookies.write("lilo_oauth_state", "state", options);
    expect(setCookie).toHaveBeenCalledWith("lilo_oauth_state", "state", options);
  });

  // A cookie set on "/" is only removed by a delete scoped to "/". Clearing it with a different
  // path silently leaves the original in place, and the session would survive signing out.
  it("clears on the same path the cookies were written to", () => {
    requestCookies.clear("lilo_session");
    expect(deleteCookie).toHaveBeenCalledWith("lilo_session", { path: "/" });
  });
});
