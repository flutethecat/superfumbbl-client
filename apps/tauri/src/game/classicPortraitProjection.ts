import { watch, type WatchStopHandle } from 'vue';
import type { GameJson, PlayerDataJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';

export interface ClassicPortraitProjectionKey {
  gameId: string | number;
  playerId: string;
  visualRevision: string;
  assetPackRevision: number;
}

export interface ClassicPortraitProjectionStats {
  entries: number;
  hits: number;
  misses: number;
  extractions: number;
  evictions: number;
}

/**
 * GPU portrait readbacks are deliberately held behind a small LRU. A match can
 * contain more than the normal sixteen players and a player can visit several
 * visual states, so the capacity is larger than one roster but still bounded.
 */
export class ClassicPortraitProjection {
  private readonly entries = new Map<string, string | null>();
  private hits = 0;
  private misses = 0;
  private extractions = 0;
  private evictions = 0;

  constructor(private readonly capacity = 96) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Classic portrait cache capacity must be positive');
  }

  resolve(key: ClassicPortraitProjectionKey, extract: () => string | null): string | null {
    const cacheKey = JSON.stringify([
      String(key.gameId), key.playerId, key.visualRevision, key.assetPackRevision,
    ]);
    if (this.entries.has(cacheKey)) {
      const cached = this.entries.get(cacheKey) ?? null;
      this.hits++;
      // Map insertion order is the LRU order.
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, cached);
      return cached;
    }

    this.misses++;
    this.extractions++;
    const portrait = extract();
    this.entries.set(cacheKey, portrait);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
    return portrait;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Read-only diagnostics used by mounted lifecycle regression tests. */
  stats(): ClassicPortraitProjectionStats {
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      extractions: this.extractions,
      evictions: this.evictions,
    };
  }
}

type ClassicRoster = {
  baseIconPath?: unknown;
  positionArray?: Array<Record<string, unknown> & { positionId?: unknown }>;
};

function portraitTeamAndPlayer(game: GameJson, playerId: string): {
  team: TeamJson;
  player: PlayerJson;
  data: PlayerDataJson;
  side: 'home' | 'away';
} | null {
  const homePlayer = game.teamHome.playerArray.find((candidate) => candidate.playerId === playerId);
  const team = homePlayer ? game.teamHome : game.teamAway;
  const player = homePlayer ?? game.teamAway.playerArray.find((candidate) => candidate.playerId === playerId);
  const data = game.fieldModel.playerDataArray.find((candidate) => candidate.playerId === playerId);
  if (!player || !data) return null;
  return { team, player, data, side: homePlayer ? 'home' : 'away' };
}

/**
 * Appearance-only fingerprint for playerPortrait(). Coordinates and the whole
 * game object are intentionally excluded: moving a token or receiving a fresh
 * server frame must not trigger a GPU extraction. The fields below are the
 * inputs used by the Classic sprite/frog/down-state/number/marking branches.
 */
export function classicPortraitVisualRevision(
  game: GameJson,
  playerId: string,
  options: { marking?: string; showPlayerNumbers?: boolean } = {},
): string | null {
  const found = portraitTeamAndPlayer(game, playerId);
  if (!found) return null;
  const { team, player, data, side } = found;
  const roster = team.roster as ClassicRoster;
  const position = roster.positionArray?.find((candidate) => candidate.positionId === player.positionId);
  return JSON.stringify({
    side,
    teamId: team.teamId,
    race: team.race,
    teamBaseIconPath: team.baseIconPath ?? null,
    rosterBaseIconPath: roster.baseIconPath ?? null,
    rosterPositionIconSet: position?.urlIconSet ?? null,
    playerKind: player.playerKind,
    playerNr: player.playerNr,
    playerType: player.playerType,
    positionId: player.positionId,
    positionIconIndex: player.positionIconIndex ?? null,
    playerIconSet: player.urlIconSet ?? null,
    strength: player.strength,
    playerState: data.playerState,
    marking: options.marking ?? '',
    showPlayerNumbers: options.showPlayerNumbers === true,
  });
}

export interface ClassicVideoOptions {
  renderScale: number;
  fpsCap: number;
}

/** Live Classic video parity with Modern. Initial application remains in the
 * renderer preset; this binding applies subsequent Settings changes. */
export function watchClassicVideoOptions(
  read: () => ClassicVideoOptions,
  apply: (options: ClassicVideoOptions) => void,
): WatchStopHandle {
  return watch(
    () => {
      const value = read();
      return [value.renderScale, value.fpsCap] as const;
    },
    ([renderScale, fpsCap], previous) => {
      if (previous && renderScale === previous[0] && fpsCap === previous[1]) return;
      apply({ renderScale, fpsCap });
    },
    { flush: 'post' },
  );
}
