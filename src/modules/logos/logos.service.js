import { fetchBuffer } from '../../core/http.js';
import { createDefaultLogoSvg, createSvgDataUri } from './default-logo.service.js';
import { sanitizeSvgContent } from './svg-sanitizer.js';

const DEFAULT_LOGO_SOURCE = 'default';
const BRAPI_LOGO_SOURCE = 'brapi';
const TRADINGVIEW_LOGO_SOURCE = 'tradingview';

export class LogosService {
  constructor({ repository, brapiLogoProvider, tradingViewLogoProvider, config }) {
    this.repository = repository;
    this.brapiLogoProvider = brapiLogoProvider;
    this.tradingViewLogoProvider = tradingViewLogoProvider;
    this.config = config;
  }

  async getLogo(symbol, { forceRefresh = false } = {}) {
    const cached = await this.repository.getAssetLogo(symbol);

    if (!forceRefresh && cached && isFresh(cached.checkedAt, this.config.logoTtlMs)) {
      return cached;
    }

    return this.syncLogo(symbol);
  }

  async getLogoUrl(symbol) {
    const logo = await this.getLogo(symbol);
    return createSvgDataUri(logo.svgContent);
  }

  async syncLogo(symbol) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const fromBrapi = await this.#tryBrapiLogo(normalizedSymbol);

    if (fromBrapi) {
      return this.#saveLogo(fromBrapi);
    }

    const fromTradingView = await this.#tryTradingViewLogo(normalizedSymbol);

    if (fromTradingView) {
      return this.#saveLogo(fromTradingView);
    }

    return this.#saveLogo({
      symbol: normalizedSymbol,
      logoUrl: null,
      svgContent: createDefaultLogoSvg(normalizedSymbol),
      source: DEFAULT_LOGO_SOURCE,
      sourceSymbol: null,
      sourceMetadata: { reason: 'external_logo_unavailable' }
    });
  }

  async syncLogos(symbols) {
    const results = [];

    for (const symbol of symbols) {
      try {
        const logo = await this.syncLogo(symbol);
        results.push({ symbol: logo.symbol, source: logo.source, status: 'synced' });
      } catch (error) {
        results.push({
          symbol: normalizeSymbol(symbol),
          source: null,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Falha desconhecida'
        });
      }
    }

    return results;
  }

  async syncMarketLogos({ maxSymbols = 50 } = {}) {
    if (!this.tradingViewLogoProvider?.fetchLogoRecords) {
      return {
        status: 'skipped',
        reason: 'tradingview_provider_unavailable',
        candidates: 0,
        synced: 0,
        results: []
      };
    }

    const marketRecords = await this.tradingViewLogoProvider.fetchLogoRecords({ limit: 5000 });
    const marketSymbols = [...new Set(marketRecords.map((record) => normalizeSymbol(record.symbol)).filter(Boolean))];
    const cachedLogos = await this.repository.listAssetLogos();
    const cachedBySymbol = new Map(cachedLogos.map((logo) => [logo.symbol, logo]));
    const candidates = marketSymbols
      .filter((symbol) => shouldSyncMarketLogo(cachedBySymbol.get(symbol), this.config.logoTtlMs))
      .slice(0, maxSymbols);

    const results = await this.syncLogos(candidates);

    return {
      status: 'completed',
      candidates: candidates.length,
      marketSymbols: marketSymbols.length,
      synced: results.filter((result) => result.status === 'synced').length,
      results
    };
  }

  async listLogos() {
    return this.repository.listAssetLogos();
  }

  async #saveLogo(value) {
    const logo = await this.repository.setAssetLogo(value);
    await this.repository.invalidateCachedQuotes?.([logo.symbol]);
    return logo;
  }

  async #tryBrapiLogo(symbol) {
    if (!this.brapiLogoProvider) {
      return null;
    }

    try {
      const logoUrl = await this.brapiLogoProvider.fetchLogoUrl(symbol);
      if (!logoUrl) {
        return null;
      }

      const svgContent = await this.#downloadSvg(logoUrl);
      if (!svgContent) {
        return null;
      }

      return {
        symbol,
        logoUrl,
        svgContent,
        source: BRAPI_LOGO_SOURCE,
        sourceSymbol: symbol,
        sourceMetadata: {}
      };
    } catch {
      return null;
    }
  }

  async #tryTradingViewLogo(symbol) {
    if (!this.tradingViewLogoProvider) {
      return null;
    }

    try {
      const logoUrl = await this.tradingViewLogoProvider.fetchLogoUrl(symbol);
      if (!logoUrl) {
        return null;
      }

      const svgContent = await this.#downloadSvg(logoUrl);
      if (!svgContent) {
        return null;
      }

      return {
        symbol,
        logoUrl,
        svgContent,
        source: TRADINGVIEW_LOGO_SOURCE,
        sourceSymbol: symbol,
        sourceMetadata: {}
      };
    } catch {
      return null;
    }
  }

  async #downloadSvg(logoUrl) {
    const buffer = await fetchBuffer(logoUrl, {
      timeoutMs: this.config.requestTimeoutMs,
      headers: { Accept: 'image/svg+xml,*/*;q=0.8' }
    });

    return sanitizeSvgContent(buffer.toString('utf8'));
  }
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase();
}

function isFresh(timestamp, ttlMs) {
  return Date.now() - new Date(timestamp).getTime() < ttlMs;
}

function shouldSyncMarketLogo(logo, ttlMs) {
  if (!logo) {
    return true;
  }

  if (logo.source === DEFAULT_LOGO_SOURCE) {
    return true;
  }

  return !isFresh(logo.checkedAt, ttlMs);
}
