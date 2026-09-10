import { readReplayFile, type ReplayFileLike } from './replayLoader';

export interface ReplayFileImportTicket<Snapshot> {
  readonly generation: number;
  readonly snapshot: Snapshot;
}

export type ReplayFileImportResult =
  | { status: 'loaded' }
  | { status: 'cancelled' | 'stale' | 'session-changed' }
  | { status: 'failed'; error: Error };

export interface ReplayFileImportRequest<Snapshot> {
  ticket: ReplayFileImportTicket<Snapshot>;
  file: ReplayFileLike;
  isCurrent(snapshot: Snapshot): boolean;
  commit(text: string, byteLength: number): void | Promise<void>;
}

export type ReplayFileContentKind = 'json' | 'jnlp';

export class ReplayFileContentError extends Error {
  constructor() {
    super('Selected file is neither a valid JSON replay nor a JNLP document.');
    this.name = 'ReplayFileContentError';
  }
}

/** Content-only dispatch; filenames and extensions are deliberately ignored. */
export function classifyReplayFileContent(text: string): ReplayFileContentKind {
  try {
    JSON.parse(text);
    return 'json';
  } catch {
    // Continue to the XML/JNLP probe.
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ReplayFileContentError();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.querySelector('parsererror') && doc.documentElement.localName === 'jnlp') return 'jnlp';
  throw new ReplayFileContentError();
}

/** Single-flight local replay intake. The newest picker action owns the only commit. */
export class ReplayFileImportCoordinator {
  private generation = 0;
  private busy = false;
  private readonly busyListeners = new Set<(busy: boolean) => void>();

  constructor(onBusy?: (busy: boolean) => void) {
    if (onBusy) this.busyListeners.add(onBusy);
  }

  subscribeBusy(listener: (busy: boolean) => void): () => void {
    this.busyListeners.add(listener);
    listener(this.busy);
    return () => this.busyListeners.delete(listener);
  }

  begin<Snapshot>(snapshot: Snapshot): ReplayFileImportTicket<Snapshot> {
    const ticket = { generation: ++this.generation, snapshot };
    this.setBusy(true);
    return ticket;
  }

  cancel(ticket?: ReplayFileImportTicket<unknown> | null): ReplayFileImportResult {
    if (!ticket || ticket.generation !== this.generation) return { status: 'stale' };
    this.setBusy(false);
    return { status: 'cancelled' };
  }

  invalidate(): void {
    this.generation += 1;
    this.setBusy(false);
  }

  async load<Snapshot>(request: ReplayFileImportRequest<Snapshot>): Promise<ReplayFileImportResult> {
    try {
      const replayFile = await readReplayFile(request.file);
      if (request.ticket.generation !== this.generation) return { status: 'stale' };
      if (!request.isCurrent(request.ticket.snapshot)) return { status: 'session-changed' };
      await request.commit(replayFile.text, replayFile.byteLength);
      return { status: 'loaded' };
    } catch (error) {
      if (request.ticket.generation !== this.generation) return { status: 'stale' };
      return { status: 'failed', error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (request.ticket.generation === this.generation) this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    for (const listener of this.busyListeners) listener(busy);
  }
}

/** App-wide intent generation shared by every local replay file entry point. */
export const sharedReplayFileImporter = new ReplayFileImportCoordinator();
