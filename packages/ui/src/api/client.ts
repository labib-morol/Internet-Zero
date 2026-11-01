import type {
  Action,
  CreateSessionResponse,
  GameEvent,
  ListWorldsResponse,
  ResumeSessionResponse,
  SubmitActionResponse,
  ViewModel,
  WorldSummary,
} from "@iz/schema";
import type { WireRuntimeState } from "../state/wire.js";

/**
 * Thin typed client over the frozen REST contract (§19.3). The server is the
 * only authority; this client never fabricates responses. Sessions are carried
 * as `Authorization: Bearer <sessionToken>`; the httpOnly cookie is also set
 * by the server but the header keeps the client testable and origin-agnostic.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ViewResponse {
  view: ViewModel;
  collectibles: Array<{ artifactId: string; label: string }>;
}

export interface IzClient {
  listWorlds(): Promise<WorldSummary[]>;
  createSession(worldId: string): Promise<CreateSessionResponse>;
  resumeSession(recoveryCode: string): Promise<ResumeSessionResponse>;
  getState(): Promise<WireRuntimeState>;
  submit(action: Action): Promise<SubmitActionResponse>;
  getView(host: string, path: string): Promise<ViewResponse>;
}

export interface IzClientOptions {
  fetchImpl?: typeof fetch;
  /** Base URL for /api; defaults to same origin (vite proxies in dev). */
  baseUrl?: string;
  /** Returns the current session token, if any. */
  getToken?: () => string | undefined;
}

async function readError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.error === "string") message = body.error;
    else if (typeof body.message === "string") message = body.message;
  } catch {
    /* non-JSON error body — keep the status message */
  }
  return new ApiError(response.status, message, code);
}

export function createIzClient(options: IzClientOptions = {}): IzClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl ?? "";

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const token = options.getToken?.();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined && init.body !== null) headers.set("content-type", "application/json");
    if (token !== undefined && token !== "") headers.set("authorization", `Bearer ${token}`);
    const response = await doFetch(`${base}${path}`, { ...init, headers });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  };

  return {
    async listWorlds() {
      const body = await request<ListWorldsResponse>("/api/worlds");
      return body.worlds;
    },
    async createSession(worldId) {
      return request<CreateSessionResponse>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ worldId }),
      });
    },
    async resumeSession(recoveryCode) {
      return request<ResumeSessionResponse>("/api/sessions/resume", {
        method: "POST",
        body: JSON.stringify({ recoveryCode }),
      });
    },
    async getState() {
      const body = await request<{ state: WireRuntimeState }>("/api/state");
      return body.state;
    },
    async submit(action) {
      return request<SubmitActionResponse>("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
    },
    async getView(host, path) {
      const params = new URLSearchParams({ host, path });
      return request<ViewResponse>(`/api/view?${params.toString()}`);
    },
  };
}

export type { GameEvent };
