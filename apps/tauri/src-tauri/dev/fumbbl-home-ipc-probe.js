// DEV-ONLY manual probe (FUMBBL.COM pane IPC), not wired into the app or any build.
//
// Shows what the docked FUMBBL webview (label "fumbbl-home", src/fumbbl_home.rs) gets back from our IPC. In a DEBUG fork
// build with `--features fumbbl-home`, open Home, right-click the FUMBBL page -> Inspect (devtools exist only in debug
// builds), paste this into that console, and read the table.
//
// Outcomes are classified by the error TEXT, not by which row it is:
//           DENIED  = tauri's own ACL rejection text - debug: "<cmd> not allowed. Plugin not found", "... not allowed on
//                     window ...", "... not allowed. Permissions associated with this command: ..."; release: "Command
//                     <cmd> not allowed by ACL" - what every app/plugin command must show.
//           UNCLEAR = any other "not allowed" (e.g. the bare "not allowed" of fumbbl_home.rs caller_is_main): our OWN
//                     handler ran, so the ACL let the call through - a finding.
//           REACHED = the channel command's own errors ("missing channel id header" / "data not found"): dispatched,
//                     nothing leaked. On any other row this is a finding.
//           ERR     = some other error - the command may have been DISPATCHED and failed on its own; investigate.
//           OK      = the call was dispatched and returned a value - a security bug (for the channel rows: a payload
//                     meant for the main page was handed to the remote page).
//           TIMEOUT = nothing came back within 3 s - NOT proof of denial; investigate.
//
// Known ACL exemption: tauri 2.11.5 skips the ACL check for `plugin:__TAURI_CHANNEL__|fetch` for EVERY origin
// (webview/mod.rs:1823-1825, "TODO: Remove this special check in v3"). It is reached from the remote page. It returns
// queued Channel payloads (> 8 KiB JSON / > 1 KiB raw) by a global sequential id from the Tauri-Channel-Id header, so
// the expected answer with no such payload queued is the command's own error ("missing channel id header" /
// "data not found"), which proves dispatch, not denial. The id rows below try the first few ids.
//
// Result on Windows / WebView2, 2026-10-05 (debug build, run via CDP Runtime.evaluate in the https://fumbbl.com page):
// all seven app/plugin rows DENIED (ACL messages); channel rows REACHED: "missing channel id header", "data not found"
// x2. No row OK, no TIMEOUT.
(async () => {
  const internals = window.__TAURI_INTERNALS__;
  const cases = [
    ['app command: settings_load', 'settings_load', {}],
    ['app command: drain_launch_jnlps', 'drain_launch_jnlps', {}],
    ['app command: keychain_get', 'keychain_get', { account: 'x' }],
    ['app command: fumbbl_home_hide', 'fumbbl_home_hide', {}],
    ['plugin: opener open_url', 'plugin:opener|open_url', { url: 'https://example.com/' }],
    ['plugin: event listen', 'plugin:event|listen', { event: 'jnlp-launch-available', target: { kind: 'Any' }, handler: 1 }],
    ['core: window set_title', 'plugin:window|set_title', { label: 'main', value: 'probe' }],
    ['ACL-exempt: channel fetch (no header)', 'plugin:__TAURI_CHANNEL__|fetch', null, undefined, true],
    ['ACL-exempt: channel fetch id 0', 'plugin:__TAURI_CHANNEL__|fetch', null, { headers: { 'Tauri-Channel-Id': '0' } }, true],
    ['ACL-exempt: channel fetch id 1', 'plugin:__TAURI_CHANNEL__|fetch', null, { headers: { 'Tauri-Channel-Id': '1' } }, true],
  ];
  const TIMEOUT = Symbol('timeout');
  const rows = { origin: location.origin, bridgeInjected: !!internals };
  for (const [name, command, args, options, exempt] of cases) {
    if (!internals) { rows[name] = 'no bridge'; continue; }
    try {
      const value = await Promise.race([
        internals.invoke(command, args, options),
        new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 3000)),
      ]);
      rows[name] = value === TIMEOUT ? 'TIMEOUT (no answer in 3 s)' : `OK ${JSON.stringify(value)?.slice(0, 60)}`;
    } catch (error) {
      const text = String(error);
      const ACL_DENIAL = /not allowed(\. Plugin not found| on window "|\. Permissions associated with this command| by ACL)/;
      const kind = ACL_DENIAL.test(text)
        ? 'DENIED'
        : /not allowed/.test(text)
          ? 'UNCLEAR (own handler ran?)'
          : /^(missing channel id header|data not found)$/.test(text)
            ? (exempt ? 'REACHED' : 'REACHED (unexpected row!)')
            : 'ERR';
      rows[name] = `${kind} ${text.slice(0, 120)}`;
    }
  }
  console.table(rows);
  return rows;
})();
