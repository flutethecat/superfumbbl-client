/**
 * Owner 10-31 (Sol r1): native JNLP intake holds. Every request waits for the first-open gate (legal + contributions);
 * a Super FUMBBL (fork) request ALSO waits for the launch-flag read to settle, because whether this run can reach the
 * fork at all is only known once `--fork-server` has been read - a request drained before then would be refused for
 * good. Each held request routes exactly once, in arrival order (a FUMBBL request is not held behind a fork one).
 * Owner 10-31 (Sol r2): "settled" means the shell ANSWERED (host or authoritative no-flag), never a timeout, so a slow
 * answer still routes the held fork request. A newer fork request supersedes an older one still waiting on the flag.
 */
export interface JnlpIntakeHoldDeps<R extends { fork: boolean }> {
  gateOpen: () => boolean;
  flagsSettled: () => boolean;
  route: (request: R) => void;
}

export interface JnlpIntakeHold<R> {
  /** A request arrived from the shell: route it now, or hold it. */
  offer: (request: R) => void;
  /** Re-check the holds (call when the gate closes or the flag read settles). */
  drain: () => void;
  /** Requests still held (test seam). */
  held: () => readonly R[];
}

export function createJnlpIntakeHold<R extends { fork: boolean }>(deps: JnlpIntakeHoldDeps<R>): JnlpIntakeHold<R> {
  const queue: R[] = [];
  const mustWait = (request: R): boolean => deps.gateOpen() || (request.fork && !deps.flagsSettled());
  return {
    offer(request) {
      if (mustWait(request)) {
        if (request.fork && !deps.flagsSettled()) {
          for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.fork) queue.splice(i, 1); // superseded
        }
        queue.push(request);
        return;
      }
      deps.route(request);
    },
    drain() {
      if (deps.gateOpen()) return;
      const ready = queue.filter((r) => !mustWait(r));
      if (!ready.length) return;
      for (const r of ready) queue.splice(queue.indexOf(r), 1);
      for (const r of ready) deps.route(r);
    },
    held: () => [...queue],
  };
}
