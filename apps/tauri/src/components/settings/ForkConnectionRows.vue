<script setup lang="ts">
// Owner 11-03 settings reflow (Sol r1 P2-1): the Connection rows a run started with the bare --fork-server flag shows.
// Game server (the target picker) works in every edition. Server URL and Tournament Bot URL are editable only in the
// FORK edition: a public build takes no custom fork host (owner, 1.0.300 fork gate), so there they are read-only and
// show the address this run actually uses.
import { FORK_EDITION } from '../../game/edition';
import { launchedWithForkServer } from '../../game/forkAccess';
import { activeServerTarget, applyServerTarget, botConfigBaseUrl, noteForkUrlEdited, serverTargets, settings } from '../../game/settings';
import { $t } from '../../i18n';
import SettingInfo from './SettingInfo.vue';
</script>

<template>
  <template v-if="launchedWithForkServer()">
    <div class="row">
      <label class="row-main">
        <span>{{ $t('settings.general.connection.serverTarget') }}</span>
        <span class="row-ctl">
          <select :value="settings.activeServerTarget" data-testid="server-target-select"
            @change="applyServerTarget(($event.target as HTMLSelectElement).value)">
            <option v-for="target in serverTargets()" :key="target.id" :value="target.id">{{ target.label }}</option>
          </select>
        </span>
      </label>
      <SettingInfo :text="$t('settings.info.serverTarget')" />
    </div>
    <template v-if="FORK_EDITION">
      <div class="row">
        <label class="row-main">
          <span>{{ $t('settings.general.connection.server') }}</span>
          <span class="row-ctl">
            <input v-model="settings.url" placeholder="ws://host:port/command" @input="noteForkUrlEdited()" />
          </span>
        </label>
        <SettingInfo :text="$t('settings.info.serverUrl')" />
      </div>
      <div class="row">
        <label class="row-main">
          <span>{{ $t('settings.general.connection.tournamentBotUrl') }}</span>
          <span class="row-ctl">
            <input v-model="settings.botConfigUrl" type="text" :placeholder="$t('settings.general.connection.botUrlOptional')" />
          </span>
        </label>
        <SettingInfo :text="$t('settings.info.botUrl')" />
      </div>
    </template>
    <template v-else>
      <div class="row">
        <label class="row-main">
          <span>{{ $t('settings.general.connection.server') }}</span>
          <span class="row-ctl">
            <input :value="activeServerTarget().url" type="text" readonly data-testid="server-url-readonly" />
          </span>
        </label>
        <SettingInfo :text="$t('settings.info.serverUrl')" />
      </div>
      <div class="row">
        <label class="row-main">
          <span>{{ $t('settings.general.connection.tournamentBotUrl') }}</span>
          <span class="row-ctl">
            <input :value="botConfigBaseUrl()" type="text" readonly data-testid="bot-url-readonly" />
          </span>
        </label>
        <SettingInfo :text="$t('settings.info.botUrl')" />
      </div>
    </template>
  </template>
</template>
