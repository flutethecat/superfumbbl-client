/**
 * Owner 10-31 (Sol r2): backstop for every config-web request. With no fork host the base URL is '' and a request
 * would go out RELATIVE (`/api/fork/...` against the app's own origin). Refuse it outright instead - the surfaces show
 * the host-unavailable explanation, and nothing is sent.
 */
import { t } from '../i18n';

export class ForkHostUnavailableError extends Error {
  constructor() {
    super(t('fork.unavailable.launchWithForkServer'));
    this.name = 'ForkHostUnavailableError';
  }
}

/** The base URL, or throw when it is not an absolute http(s) origin. */
export function requireForkBaseUrl(baseUrl: string): string {
  if (!baseUrl || !/^https?:\/\/[^/]/i.test(baseUrl)) throw new ForkHostUnavailableError();
  return baseUrl;
}
