/**
 * Owner 10-31 (Sol r3): the Connection pane's "Register this coach on the fork" request, out of App.vue so it can be
 * tested. Only the digest leaves (forkRegisterUrl, owner ruling 08-17). With no fork host forkRegisterUrl refuses to
 * build a (relative) URL and NOTHING is sent: the caller shows the actionable message.
 */
import { forkRegisterUrl } from './settings';
import { ForkHostUnavailableError } from './forkBase';

export type ForkRegistrationOutcome =
  | { ok: true }
  | { ok: false; hostUnavailable: boolean; message: string };

export async function requestForkRegistration(
  params: { coach: string; password: string },
  transport: (url: string) => Promise<Response>,
): Promise<ForkRegistrationOutcome> {
  let url: string;
  try {
    url = forkRegisterUrl(params);
  } catch (error) {
    if (error instanceof ForkHostUnavailableError) return { ok: false, hostUnavailable: true, message: error.message };
    throw error;
  }
  try {
    const res = await transport(url);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.error) return { ok: false, hostUnavailable: false, message: data.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, hostUnavailable: false, message: error instanceof Error ? error.message : String(error) };
  }
}
