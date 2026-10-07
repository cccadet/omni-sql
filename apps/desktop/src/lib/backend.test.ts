// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

describe("backend authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it("gets the per-run token from Tauri and sends it on RPC calls", async () => {
    vi.mocked(invoke).mockResolvedValue("run-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { backend } = await import("./backend");
    await backend.call("health", {});

    expect(invoke).toHaveBeenCalledWith("get_auth_token");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: "Bearer run-token",
      },
    });
  });

  it("keeps the browser dev preview usable when Tauri is unavailable", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("not running in Tauri"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { backend } = await import("./backend");
    await backend.call("health", {});

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: "Bearer dev-token",
      },
    });
  });

  it("keeps desktop readiness failures visible and retries the Tauri token on the next call", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("backend did not become ready before timeout"))
      .mockResolvedValueOnce("ready-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
      { headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { backend } = await import("./backend");
    await expect(backend.call("connection.list", {})).rejects.toThrow("backend did not become ready before timeout");
    expect(fetchMock).not.toHaveBeenCalled();
    await backend.call("connection.list", {});
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer ready-token" } });
  });

  it("fails explicitly for non-2xx responses", async () => {
    vi.mocked(invoke).mockResolvedValue("run-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", {
      status: 401,
      statusText: "Unauthorized",
    })));

    const { backend } = await import("./backend");
    await expect(backend.call("health", {})).rejects.toThrow("401 Unauthorized");
  });

  it("fails explicitly for an invalid response body", async () => {
    vi.mocked(invoke).mockResolvedValue("run-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ));

    const { backend } = await import("./backend");
    await expect(backend.call("health", {})).rejects.toThrow("invalid JSON-RPC body");
  });
});
