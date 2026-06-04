import { AppError, toErrorResponse } from "./core/errors.js";
import { readJsonBody } from "./core/http.js";
import { parseQuoteQuery, parseSymbols, normalizeSymbol } from "./modules/quotes/quote-query.js";

export function createApp({
  config,
  repository,
  quotesService,
  scheduler,
  documentsService = null,
  documentScheduler = null,
  logosService = null,
  assetsService = null,
  aiContextService = null,
  dataQualityService = null,
  eventsService = null,
  incomeService = null,
  valuationService = null
}) {
  const limiter = createRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);

  return async function handler(request, response) {
    setCorsHeaders(request, response, config.corsOrigins);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      limiter.assertAllowed(request.socket.remoteAddress ?? "unknown");

      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        await repository.ping?.();
        return sendJson(response, 200, {
          status: "ok",
          service: "market-data-api",
          timestamp: new Date().toISOString()
        });
      }

      const quoteMatch = url.pathname.match(/^\/api\/quote\/([^/]+)$/);
      if (request.method === "GET" && quoteMatch) {
        const symbols = parseSymbols(decodeURIComponent(quoteMatch[1]), config.maxTickers);
        const query = parseQuoteQuery(url.searchParams);
        const result = await quotesService.getQuotes(symbols, query);
        if (result.isStale) {
          response.setHeader("X-Market-Data-Stale", "true");
        }
        const { isStale, ...body } = result;
        return sendJson(response, 200, body);
      }

      const assetProfileMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/profile$/);
      if (assetsService && request.method === "GET" && assetProfileMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(assetProfileMatch[1]));
        return sendJson(response, 200, await assetsService.getProfile(symbol));
      }

      const assetAiContextMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/ai-context$/);
      if (aiContextService && request.method === "GET" && assetAiContextMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(assetAiContextMatch[1]));
        return sendJson(response, 200, await aiContextService.get(symbol));
      }

      if (aiContextService && request.method === "POST" && url.pathname === "/api/ai-context") {
        const body = await readJsonBody(request);
        const symbols = parseSymbols((body.symbols ?? []).join(","), config.maxTickers);
        return sendJson(response, 200, { results: await aiContextService.getMany(symbols) });
      }

      const valuationMatch = url.pathname.match(/^\/api\/valuation\/([^/]+)$/);
      if (valuationService && request.method === "GET" && valuationMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(valuationMatch[1]));
        return sendJson(response, 200, await valuationService.evaluate(symbol));
      }

      const incomeMatch = url.pathname.match(/^\/api\/income\/([^/]+)$/);
      if (incomeService && request.method === "GET" && incomeMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(incomeMatch[1]));
        return sendJson(response, 200, await incomeService.summary(symbol, parseIncomeFilters(url.searchParams)));
      }

      if (incomeService && request.method === "GET" && url.pathname === "/api/income") {
        const symbols = parseOptionalSymbols(url.searchParams.get("symbols"), config.maxTickers);
        return sendJson(response, 200, { income: await incomeService.listMany(symbols, parseIncomeFilters(url.searchParams)) });
      }

      if (eventsService && request.method === "GET" && url.pathname === "/api/events") {
        const symbols = parseOptionalSymbols(url.searchParams.get("symbols"), config.maxTickers);
        return sendJson(response, 200, { events: await eventsService.list(parseEventFilters(url.searchParams, symbols)) });
      }

      if (eventsService && request.method === "POST" && url.pathname === "/api/events/sync") {
        const body = await readJsonBody(request);
        const symbols = Array.isArray(body.symbols) && body.symbols.length
          ? parseSymbols(body.symbols.join(","), config.maxTickers)
          : await repository.listMonitored();
        return sendJson(response, 202, await eventsService.syncFromDocuments(symbols));
      }

      const assetEventsMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/events$/);
      if (eventsService && request.method === "GET" && assetEventsMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(assetEventsMatch[1]));
        return sendJson(response, 200, { symbol, events: await eventsService.listBySymbol(symbol, parseEventFilters(url.searchParams)) });
      }

      const dataQualityMatch = url.pathname.match(/^\/api\/data-quality\/([^/]+)$/);
      if (dataQualityService && request.method === "GET" && dataQualityMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(dataQualityMatch[1]));
        return sendJson(response, 200, await dataQualityService.get(symbol));
      }

      if (dataQualityService && request.method === "GET" && url.pathname === "/api/data-quality") {
        const requestedSymbols = url.searchParams.get("symbols");
        const symbols = requestedSymbols ? parseSymbols(requestedSymbols, config.maxTickers) : await repository.listMonitored();
        return sendJson(response, 200, { results: await dataQualityService.list(symbols) });
      }

      const fundamentalsMatch = url.pathname.match(/^\/api\/fundamentals\/([^/]+)$/);
      if (request.method === "GET" && fundamentalsMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(fundamentalsMatch[1]));
        const fundamentals = await quotesService.getFundamentals(symbol);
        return sendJson(response, 200, await withLogo(fundamentals));
      }

      if (logosService && request.method === "GET" && url.pathname === "/api/logos") {
        const logos = await logosService.listLogos();
        return sendJson(response, 200, {
          logos: logos.map(({ svgContent, ...logo }) => ({ ...logo, hasSvgContent: Boolean(svgContent) }))
        });
      }

      if (logosService && request.method === "POST" && url.pathname === "/api/logos/sync") {
        const body = await readJsonBody(request);
        const symbols = Array.isArray(body.symbols) && body.symbols.length
          ? parseSymbols(body.symbols.join(","), config.maxTickers)
          : await repository.listMonitored();
        if (!symbols.length) {
          throw new AppError(400, "BAD_REQUEST", "Nenhum ativo informado ou monitorado para sincronização de logos");
        }
        return sendJson(response, 202, { results: await logosService.syncLogos(symbols) });
      }

      const logoMatch = url.pathname.match(/^\/api\/logos\/([^/]+)$/);
      if (logosService && request.method === "GET" && logoMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(logoMatch[1]));
        const logo = await logosService.getLogo(symbol);
        return sendSvg(response, logo.svgContent);
      }

      if (documentsService && request.method === "POST" && url.pathname === "/api/documents/sync") {
        if (!config.cvmFiiEnabled && !config.fnetFiiEnabled) {
          throw new AppError(503, "PROVIDER_DISABLED", "Sincronização de documentos oficiais está desabilitada");
        }
        const body = await readJsonBody(request);
        const symbols = Array.isArray(body.symbols) && body.symbols.length
          ? parseSymbols(body.symbols.join(","), config.documentMaxSymbolsPerRun)
          : (await repository.listMonitored()).filter((symbol) => /11$/.test(symbol)).slice(0, config.documentMaxSymbolsPerRun);
        if (!symbols.length) {
          throw new AppError(400, "BAD_REQUEST", "Nenhum FII informado ou monitorado para sincronização");
        }
        const results = documentScheduler ? await documentScheduler.run(symbols) : await documentsService.sync(symbols);
        return sendJson(response, 202, { results: await withLogos(results) });
      }

      if (documentsService && request.method === "GET" && url.pathname === "/api/documents") {
        const symbols = parseSymbols(url.searchParams.get("symbols") ?? "", config.documentMaxSymbolsPerRun);
        const filters = parseDocumentFilters(url.searchParams, config.documentMaxResults);
        const documents = await documentsService.listRecent(symbols, filters);
        return sendJson(response, 200, { documents: await withLogos(documents) });
      }

      const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/([0-9]+))?$/);
      if (documentsService && request.method === "GET" && documentMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(documentMatch[1]));
        if (documentMatch[2]) {
          return sendJson(response, 200, await withLogo(await documentsService.get(symbol, documentMatch[2]), symbol));
        }
        const documents = await documentsService.list(symbol, parseDocumentFilters(url.searchParams, config.documentMaxResults));
        return sendJson(response, 200, await withLogos(documents, symbol));
      }

      if (request.method === "GET" && url.pathname === "/api/monitored") {
        const symbols = await repository.listMonitored();
        return sendJson(response, 200, {
          symbols,
          assets: await withLogos(symbols.map((symbol) => ({ symbol })))
        });
      }

      if (request.method === "POST" && url.pathname === "/api/monitored") {
        const symbols = await readMonitoredSymbols(request, config.maxTickers);
        const updatedSymbols = await repository.addMonitored(symbols);
        return sendJson(response, 201, {
          symbols: updatedSymbols,
          assets: await withLogos(updatedSymbols.map((symbol) => ({ symbol })))
        });
      }

      if (request.method === "PUT" && url.pathname === "/api/monitored") {
        const symbols = await readMonitoredSymbols(request, config.maxTickers, true);
        const updatedSymbols = await repository.replaceMonitored(symbols);
        return sendJson(response, 200, {
          symbols: updatedSymbols,
          assets: await withLogos(updatedSymbols.map((symbol) => ({ symbol })))
        });
      }

      const monitoredMatch = url.pathname.match(/^\/api\/monitored\/([^/]+)$/);
      if (request.method === "DELETE" && monitoredMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(monitoredMatch[1]));
        const updatedSymbols = await repository.removeMonitored(symbol);
        return sendJson(response, 200, {
          symbols: updatedSymbols,
          assets: await withLogos(updatedSymbols.map((item) => ({ symbol: item })))
        });
      }

      if (request.method === "GET" && url.pathname === "/api/snapshots") {
        const requestedSymbols = url.searchParams.get("symbols");
        const symbols = requestedSymbols
          ? parseSymbols(requestedSymbols, config.maxTickers)
          : await repository.listMonitored();
        const limit = parseSnapshotLimit(url.searchParams.get("limit"));
        const results = await repository.getSnapshotsBySymbols(symbols, limit);
        return sendJson(response, 200, { results: await withLogos(results) });
      }

      const snapshotsMatch = url.pathname.match(/^\/api\/snapshots\/([^/]+)$/);
      if (request.method === "GET" && snapshotsMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(snapshotsMatch[1]));
        const limit = parseSnapshotLimit(url.searchParams.get("limit"));
        return sendJson(response, 200, await withLogo({
          symbol,
          snapshots: await repository.getSnapshots(symbol, limit)
        }));
      }

      if (request.method === "POST" && url.pathname === "/api/monitored/refresh") {
        await scheduler.run();
        return sendJson(response, 202, { message: "Atualização dos ativos monitorados executada" });
      }

      throw new AppError(404, "NOT_FOUND", "Recurso não encontrado");
    } catch (error) {
      const result = toErrorResponse(error);
      sendJson(response, result.statusCode, result.body);
    }
  };

  async function withLogo(item, fallbackSymbol = null) {
    if (!item || !logosService) {
      return item;
    }

    const symbol = fallbackSymbol ?? item.symbol;
    if (!symbol) {
      return item;
    }

    try {
      return {
        ...item,
        logourl: await logosService.getLogoUrl(symbol)
      };
    } catch (error) {
      console.warn(`[market-data-api] Logo indisponível para ${symbol}: ${error.message}`);
      return {
        ...item,
        logourl: null
      };
    }
  }

  async function withLogos(items, fallbackSymbol = null) {
    return Promise.all(items.map((item) => withLogo(item, fallbackSymbol)));
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendSvg(response, svgContent) {
  response.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400"
  });
  response.end(svgContent);
}

function setCorsHeaders(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
}

function createRateLimiter(windowMs, maximumRequests) {
  const clients = new Map();

  return {
    assertAllowed(client) {
      const now = Date.now();
      const record = clients.get(client);

      if (!record || now >= record.expiresAt) {
        clients.set(client, { count: 1, expiresAt: now + windowMs });
        return;
      }

      record.count += 1;
      if (record.count > maximumRequests) {
        throw new AppError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições excedido. Tente novamente mais tarde.");
      }
    }
  };
}

async function readMonitoredSymbols(request, maximumSymbols, allowEmpty = false) {
  const body = await readJsonBody(request);
  const requestedSymbols = Array.isArray(body.symbols)
    ? body.symbols
    : typeof body.symbol === "string"
      ? [body.symbol]
      : null;

  if (!requestedSymbols) {
    throw new AppError(400, "BAD_REQUEST", "Informe symbol ou symbols com os tickers monitorados");
  }

  if (allowEmpty && requestedSymbols.length === 0) {
    return [];
  }

  return parseSymbols(requestedSymbols.join(","), maximumSymbols);
}

function parseOptionalSymbols(rawSymbols, maximumSymbols) {
  return rawSymbols ? parseSymbols(rawSymbols, maximumSymbols) : [];
}

function parseSnapshotLimit(rawLimit) {
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new AppError(400, "BAD_REQUEST", "limit deve ser um número inteiro entre 1 e 10000");
  }
  return limit;
}

function parseDocumentFilters(searchParams, maximumLimit) {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? Math.min(20, maximumLimit) : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new AppError(400, "BAD_REQUEST", `limit deve ser um número inteiro entre 1 e ${maximumLimit}`);
  }
  const since = searchParams.get("since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new AppError(400, "BAD_REQUEST", "since deve estar no formato YYYY-MM-DD");
  }
  return { type: searchParams.get("type"), source: searchParams.get("source"), limit, since };
}

function parseEventFilters(searchParams, symbols = []) {
  const limit = parseSimpleLimit(searchParams.get("limit"), 50, 500);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  assertDateFilter(from, "from");
  assertDateFilter(to, "to");

  return { symbols, from, to, limit };
}

function parseIncomeFilters(searchParams) {
  return {
    limit: parseSimpleLimit(searchParams.get("limit"), 120, 1000),
    years: parseSimpleLimit(searchParams.get("years"), 5, 30)
  };
}

function parseSimpleLimit(rawLimit, fallback, maximum) {
  if (rawLimit === null) return fallback;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new AppError(400, "BAD_REQUEST", `limit deve ser um número inteiro entre 1 e ${maximum}`);
  }
  return limit;
}

function assertDateFilter(value, fieldName) {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, "BAD_REQUEST", `${fieldName} deve estar no formato YYYY-MM-DD`);
  }
}
