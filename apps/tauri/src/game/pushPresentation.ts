import type { GameJson } from '@fumbbl40k/ffb-protocol';
export interface PendingPush { from: [number, number]; age: number }
/** Report-plus-coordinate transition projection shared by live and historical presentation. */
export function pushPresentation(previous: ReadonlyMap<string, PendingPush>, reports: readonly Record<string, unknown>[],
  game: GameJson, coordinates: ReadonlyMap<string, readonly number[] | null>, maxAge = 6) {
  const pendingPushes = new Map<string, PendingPush>([...previous].map(([id, value]) => [id, { from: [...value.from], age: value.age }]));
  const preCoords = new Map<string, [number, number] | null>([...coordinates].map(([id, value]) => [id, value ? [value[0]!, value[1]!] : null]));
  const lastPushFrom = new Map<string, [number, number]>();
  const grabbers: string[] = [];
    const onPitch = (s: [number, number]) => s[0] >= 0 && s[0] < 26 && s[1] >= 0 && s[1] < 15;
    // 1. register pushes signalled this frame (dedup by player)
    for (const report of reports) {
      const id = String(report.reportId);
      let pid = '';
      if (id === 'pushback') {
        pid = String(report.defenderId ?? report.playerId ?? '');
        // #79: GRAB push = mode 'grab', NO skillUse report — grabber = the acting blocker (PushbackMessage.java:25-28).
        if (String(report.pushbackMode) === 'grab') {
          const grabber = String((game.actingPlayer as { playerId?: string } | undefined)?.playerId ?? '');
          if (grabber) grabbers.push(grabber);
        }
      } else if (id === 'blockChoice') {
        const res = String(report.blockResult ?? '').toUpperCase();
        if (res.includes('PUSH')) pid = String(report.defenderId ?? '');
      }
      if (!pid) continue;
      const from = preCoords.get(pid) ?? null;
      if (from && onPitch(from)) pendingPushes.set(pid, { from, age: 0 });
    }
    // 2. fire arrows for pending pushes whose player has now moved; age out/clear
    const arrows: { from: [number, number]; to: [number, number] }[] = [];
    const arrowedThisFrame = new Set<string>();
    for (const [pid, entry] of [...pendingPushes]) {
      const data = game.fieldModel.playerDataArray.find((d) => d.playerId === pid);
      const to = data?.playerCoordinate ? ([data.playerCoordinate[0], data.playerCoordinate[1]] as [number, number]) : null;
      if (to && onPitch(to) && (to[0] !== entry.from[0] || to[1] !== entry.from[1])) {
        arrows.push({ from: entry.from, to });
        arrowedThisFrame.add(pid);
        lastPushFrom.set(pid, entry.from); // the vacated square, for followupChoice
        pendingPushes.delete(pid);
      } else if (!to || !onPitch(to) || ++entry.age > maxAge) {
        pendingPushes.delete(pid); // pushed off pitch / removed, or aged out
      }
    }
    // 2b. CHAIN pushes (07-08): BB2025 emits NO report for the chain victim — detect by RULE (whoever stood on a pushed player's destination is chain-pushed); the growing loop resolves multi-link chains.
    for (let i = 0; i < arrows.length; i++) {
      const dest = arrows[i]!.to;
      for (const d of game.fieldModel.playerDataArray) {
        const cpid = d.playerId;
        if (arrowedThisFrame.has(cpid) || pendingPushes.has(cpid)) continue;
        const cfrom = preCoords.get(cpid);
        if (!cfrom || !onPitch(cfrom) || cfrom[0] !== dest[0] || cfrom[1] !== dest[1]) continue;
        const cto = d.playerCoordinate ? ([d.playerCoordinate[0], d.playerCoordinate[1]] as [number, number]) : null;
        if (cto && onPitch(cto) && (cto[0] !== cfrom[0] || cto[1] !== cfrom[1])) {
          arrows.push({ from: cfrom, to: cto }); // already vacated → arrow now (loop chains off it)
          arrowedThisFrame.add(cpid);
          lastPushFrom.set(cpid, cfrom);
        } else {
          pendingPushes.set(cpid, { from: cfrom, age: 0 }); // not moved yet → fire on its move frame
        }
      }
    }

  return { pending: pendingPushes, arrows, lastFrom: lastPushFrom, grabbers };
}
