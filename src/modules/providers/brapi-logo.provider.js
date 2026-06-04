import { fetchJson } from '../../core/http.js';

export class BrapiLogoProvider {
  constructor({ baseUrl, token, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async fetchLogoUrl(symbol) {
    if (!this.token) {
      return null;
    }

    const url = new URL(`/api/quote/${encodeURIComponent(symbol)}`, this.baseUrl);
    url.searchParams.set('token', this.token);

    const payload = await fetchJson(url, { timeoutMs: this.timeoutMs });
    const logoUrl = payload?.results?.[0]?.logourl;

    return typeof logoUrl === 'string' && logoUrl.startsWith('https://') ? logoUrl : null;
  }
}
