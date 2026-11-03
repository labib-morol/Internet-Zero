import type { EventEnvelope } from "@iz/schema";
import type { ServerMsg } from "@iz/schema";

/**
 * Team event stream (§12). One connection per session: hello → welcome +
 * replay of events after lastSeq → live events. Reconnects with capped
 * exponential backoff; keeps lastSeq so the server can replay anything missed.
 * A 1008 close during hello means the token is dead — reported as
 * "unauthorized" instead of retrying forever.
 */

export type TeamSocketStatus = "connecting" | "online" | "offline" | "unauthorized";

export interface TeamSocketHandlers {
  onEnvelopes: (envelopes: EventEnvelope[], seq: number) => void;
  onStatus: (status: TeamSocketStatus) => void;
}

export interface TeamSocketOptions {
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  /** Injected timers for tests. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export class TeamSocket {
  readonly #handlers: TeamSocketHandlers;
  readonly #url: string;
  readonly #WebSocketImpl: typeof WebSocket | undefined;
  readonly #setTimeoutImpl: typeof setTimeout;
  readonly #clearTimeoutImpl: typeof clearTimeout;
  #socket: WebSocket | undefined;
  #token: string | undefined;
  #lastSeq = 0;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = true;

  constructor(handlers: TeamSocketHandlers, options: TeamSocketOptions = {}) {
    this.#handlers = handlers;
    this.#WebSocketImpl = options.WebSocketImpl ?? (typeof WebSocket === "undefined" ? undefined : WebSocket);
    this.#setTimeoutImpl = options.setTimeoutImpl ?? setTimeout.bind(globalThis);
    this.#clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout.bind(globalThis);
    if (options.url !== undefined) {
      this.#url = options.url;
    } else if (typeof location !== "undefined") {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      this.#url = `${scheme}://${location.host}/ws`;
    } else {
      this.#url = "ws://localhost:8080/ws";
    }
  }

  /** Latest sequence number seen (starts at 0 → full replay on first hello). */
  get lastSeq(): number {
    return this.#lastSeq;
  }

  /** Seed the replay cursor (e.g. from a previous page session). */
  setLastSeq(seq: number): void {
    if (seq > this.#lastSeq) this.#lastSeq = seq;
  }

  get connected(): boolean {
    return this.#socket !== undefined && this.#socket.readyState === WebSocket.OPEN && !this.#stopped;
  }

  start(token: string): void {
    this.#token = token;
    if (!this.#stopped && this.#socket !== undefined) return;
    this.#stopped = false;
    this.#open();
  }

  /** Reconnect with a fresh team binding (invite join, §12). */
  restart(token: string): void {
    this.stop();
    this.start(token);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retryTimer !== undefined) {
      this.#clearTimeoutImpl(this.#retryTimer);
      this.#retryTimer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket !== undefined) {
      try {
        socket.close(1000, "client stop");
      } catch {
        /* already closing */
      }
    }
  }

  #open(): void {
    if (this.#stopped || this.#token === undefined) return;
    if (this.#WebSocketImpl === undefined) {
      this.#handlers.onStatus("offline");
      return; // no WebSocket in this environment (tests); REST still works
    }
    this.#handlers.onStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new this.#WebSocketImpl(this.#url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ t: "hello", sessionToken: this.#token, lastSeq: this.#lastSeq }));
    };
    socket.onmessage = (raw: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(raw.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "welcome") {
        this.#attempt = 0;
        if (msg.seq > this.#lastSeq) this.#lastSeq = msg.seq;
        this.#handlers.onStatus("online");
      } else if (msg.t === "events") {
        if (msg.seq > this.#lastSeq) this.#lastSeq = msg.seq;
        this.#handlers.onEnvelopes(msg.events, msg.seq);
      }
    };
    socket.onclose = (event: CloseEvent) => {
      this.#socket = undefined;
      if (this.#stopped) return;
      if (event.code === 1008) {
        // Token rejected (invalid/expired session). Do not spin.
        this.#handlers.onStatus("unauthorized");
        this.#stopped = true;
        return;
      }
      this.#scheduleRetry();
    };
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  #scheduleRetry(): void {
    if (this.#stopped) return;
    this.#handlers.onStatus("offline");
    const delay = Math.min(1000 * 2 ** this.#attempt, 15_000);
    this.#attempt += 1;
    this.#retryTimer = this.#setTimeoutImpl(() => this.#open(), delay);
  }
}
