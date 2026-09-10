import { FrameCodec } from './frameCodec';
import type { NetCommand } from '../commands/types';

/**
 * Minimal isomorphic WebSocket surface (browser WebSocket and `ws` both fit).
 */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface FfbConnectionOptions {
  /** e.g. wss://fumbbl.com:22223/command — always ends in /command */
  url: string;
  /** Defaults to globalThis.WebSocket; inject `ws` in Node. */
  webSocketFactory?: WebSocketFactory;
  compression?: boolean;
}

export interface FfbConnectionEvents {
  command: (command: NetCommand) => void;
  close: (code: number, reason: string) => void;
  error: (error: unknown) => void;
}

const WS_OPEN = 1;

/**
 * WebSocket transport for the FFB protocol: JSON commands in optionally
 * LZString-compressed frames (sent as binary UTF-8, matching the Java client).
 */
export class FfbConnection {
  private readonly codec: FrameCodec;
  private socket: WebSocketLike | null = null;
  private readonly listeners: { [K in keyof FfbConnectionEvents]: Set<FfbConnectionEvents[K]> } = {
    command: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(private readonly options: FfbConnectionOptions) {
    this.codec = new FrameCodec(options.compression ?? false);
  }

  get compression(): boolean {
    return this.codec.compression;
  }

  /** Compression can be enabled mid-session once ServerCommandVersion announces it. */
  setCompression(enabled: boolean): void {
    this.codec.compression = enabled;
  }

  on<K extends keyof FfbConnectionEvents>(event: K, listener: FfbConnectionEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  async connect(): Promise<void> {
    const factory: WebSocketFactory =
      this.options.webSocketFactory ??
      ((url) => new (globalThis as any).WebSocket(url) as WebSocketLike);
    const socket = factory(this.options.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('message', (event: { data: string | ArrayBuffer | Uint8Array }) => {
      try {
        const json = this.codec.decode(event.data);
        const command = JSON.parse(json) as NetCommand;
        for (const listener of this.listeners.command) listener(command);
      } catch (error) {
        for (const listener of this.listeners.error) listener(error);
      }
    });
    socket.addEventListener('close', (event: { code?: number; reason?: string }) => {
      for (const listener of this.listeners.close) listener(event.code ?? 0, event.reason ?? '');
    });

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', (event: unknown) => {
        for (const listener of this.listeners.error) listener(event);
        reject(new Error(`WebSocket connection to ${this.options.url} failed`));
      });
    });
  }

  get isOpen(): boolean {
    return this.socket != null && this.socket.readyState === WS_OPEN;
  }

  send(command: NetCommand): void {
    if (!this.socket || !this.isOpen) {
      throw new Error('FfbConnection: not connected');
    }
    this.socket.send(this.codec.encode(JSON.stringify(command)));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
