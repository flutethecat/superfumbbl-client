/**
 * The chat box's slash-command router (owner ruling "Option 1", 11-09): ONE router, in every build, for every line
 * typed into the in-game chat that starts with `/`. A slash line is never sent as ordinary chat by mistake: the server
 * broadcasts any line it cannot use to everyone in the game as chat (TalkHandler.handle / ServerCommandHandlerTalk), so
 * a typo such as `/cheeer` would reach the opponent. The router answers it here instead.
 *
 * PUBLIC layer (shipped in both editions): the upstream USER commands that every FUMBBL server accepts, read from
 * ffb-server/.../handler/talk/ (TalkHandlerSpecs.java, TalkHandlerEmote.java) and ffb-common/.../ChatCommand.java:
 *   /specs                     any client: lists the spectators (answer to the sender only)
 *   /aah /boo /cheer /clap /crickets /hurt /laugh /ooh /shock /stomp   spectator sessions only: a crowd sound
 * They go to whatever server is connected (official FUMBBL or the fork). `/help` lists them, locally.
 *
 * A message that only LOOKS like a command is refused too, never sent as chat (Sol r1): a slash lookalike (fullwidth,
 * division or fraction slash ...) or invisible characters before the slash, a command line inside a multi-line message,
 * or a tab / other kind of space inside a command.
 *
 * Everything else is refused locally, unless an EXTENSION claims it. The fork / dev edition registers one (its dev
 * command catalogue and the client-local /stuck /pass /endturn) from a private, export-stripped seam in App.vue; this
 * file never imports it and knows nothing about it beyond the interface below.
 */

export type ChatRole = 'player' | 'spectator';

/** ChatCommand.java: the spectator emotes (each plays a sound with a caption). */
export const SPECTATOR_EMOTES: readonly string[] = ['/aah', '/boo', '/cheer', '/clap', '/crickets', '/hurt', '/laugh', '/ooh', '/shock', '/stomp'];
export const SPECS_COMMAND = '/specs';
export const HELP_COMMAND = '/help';

export type ChatRefusal = 'unknown' | 'spectatorsOnly' | 'unavailable' | 'invalid' | 'whitespace' | 'lookalike' | 'multiline';

/** Slash lookalikes a coach may type or paste: fullwidth, division, fraction, big solidus, box-drawing diagonal,
 *  mathematical rising diagonal. */
export const SLASH_LOOKALIKES = '\uFF0F\u2215\u2044\u29F8\u2571\u27CB';
/** Invisible characters that may lead a line (Sol r2: by Unicode property, not a hand list): whitespace, format
 *  characters, control characters (Sol r3: backspace, escape ...), every Default_Ignorable_Code_Point (zero-width / joiners, variation selectors, combining grapheme
 *  joiner, Hangul fillers ...) and combining marks, which have no base to sit on at the start of a line. */
const INVISIBLE_LEAD = /^[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{M}\u115F\u1160\u3164\uFFA0]*/u;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029\u0085\u000B\u000C]/;
/** Any whitespace other than the plain ASCII space (the server splits on ASCII spaces only). */
const OTHER_WHITESPACE = /[^\S ]/;

/** Does this line LOOK like a command (after invisible leading characters, with any slash lookalike)? Routing only. */
export function looksLikeCommand(line: string): boolean {
  const lead = line.replace(INVISIBLE_LEAD, '').charAt(0);
  return lead !== '' && (lead === '/' || SLASH_LOOKALIKES.includes(lead)); // a blank line never looks like a command
}

export type ChatRoute =
  | { kind: 'chat'; text: string }
  /** Sent to the server as one talk line, exactly `text`. */
  | { kind: 'send'; text: string }
  /** A client-local command (run by the store's command handler, never sent as talk). */
  | { kind: 'local'; text: string }
  | { kind: 'help' }
  /** Not sent. `detail` is extra (extension-authored) explanation. */
  | { kind: 'refuse'; reason: ChatRefusal; command: string; detail?: string };

/** A build-specific add-on (the fork edition's dev commands). Returns null for a line it does not handle. */
export interface ChatCommandExtension {
  route(text: string, word: string, role: ChatRole): ChatRoute | null;
  /** Extra /help lines (the extension's own copy). */
  helpLines(): string[];
}

let extension: ChatCommandExtension | null = null;
/** Registered once by the fork edition (App.vue, private seam). Null clears it (tests). */
export function setChatCommandExtension(ext: ChatCommandExtension | null): void { extension = ext; }
export function chatCommandExtension(): ChatCommandExtension | null { return extension; }

/**
 * Route one chat message (the whole textarea). Order: a command line inside a multi-line message (refused) -> plain
 * chat -> a disguised command (refused) -> whitespace other than plain spaces (refused) -> /help -> /specs -> emotes ->
 * extension -> unknown (refused). Every refusal is a line the server would otherwise show to the game as chat. The
 * server splits a talk line on ASCII spaces only (TalkHandler: talk.split(" +")) and matches the first word exactly,
 * so the router takes the command word the same way.
 */
export function routeChatLine(raw: string, role: ChatRole, ext: ChatCommandExtension | null = extension): ChatRoute {
  const text = raw.trim();
  const lines = text.split(LINE_BREAK);
  if (lines.length > 1 && lines.some(looksLikeCommand)) return { kind: 'refuse', reason: 'multiline', command: '' };
  if (!looksLikeCommand(text)) return { kind: 'chat', text };
  if (!text.startsWith('/')) return { kind: 'refuse', reason: 'lookalike', command: '' };
  if (OTHER_WHITESPACE.test(text)) return { kind: 'refuse', reason: 'whitespace', command: text.split(/\s/)[0] ?? '' };
  const word = text.split(' ')[0] ?? '';
  if (word === HELP_COMMAND) return { kind: 'help' };
  if (word === SPECS_COMMAND) return { kind: 'send', text };
  if (SPECTATOR_EMOTES.includes(word)) {
    return role === 'spectator' ? { kind: 'send', text } : { kind: 'refuse', reason: 'spectatorsOnly', command: word };
  }
  const claimed = ext?.route(text, word, role) ?? null;
  if (claimed) return claimed;
  return { kind: 'refuse', reason: 'unknown', command: word };
}

/** What running a routed line needs from the app (the store's talk sender, its command handler, a chat reply). */
export interface ChatCommandDeps {
  sendTalk(text: string): void;
  localCommand(text: string): void;
  /** Show a client reply in the chat: an i18n key + params, or extension-authored text. */
  reply(message: { key: string; params?: Record<string, unknown> } | { text: string }): void;
}

export const CHAT_HELP_KEYS = ['chat.commands.helpTitle', 'chat.commands.helpSpecs', 'chat.commands.helpEmotes'] as const;
export const CHAT_REFUSAL_KEYS: Readonly<Record<ChatRefusal, string>> = {
  unknown: 'chat.commands.unknown',
  spectatorsOnly: 'chat.commands.spectatorsOnly',
  unavailable: 'chat.commands.unavailable',
  invalid: 'chat.commands.invalid',
  whitespace: 'chat.commands.whitespace',
  lookalike: 'chat.commands.lookalike',
  multiline: 'chat.commands.multiline',
};

/** Route and run one chat message. Returns the route taken. */
export function runChatLine(raw: string, role: ChatRole, deps: ChatCommandDeps, ext: ChatCommandExtension | null = extension): ChatRoute {
  const route = routeChatLine(raw, role, ext);
  switch (route.kind) {
    case 'chat':
    case 'send': deps.sendTalk(route.text); break;
    case 'local': deps.localCommand(route.text); break;
    case 'help':
      for (const key of CHAT_HELP_KEYS) deps.reply({ key });
      for (const text of ext?.helpLines() ?? []) deps.reply({ text });
      break;
    case 'refuse':
      deps.reply({ key: CHAT_REFUSAL_KEYS[route.reason], params: { command: route.command } });
      if (route.detail) deps.reply({ text: route.detail });
      break;
  }
  return route;
}
