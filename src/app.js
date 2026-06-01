import { AppError, toErrorResponse } from "./core/errors.js";
import { readJsonBody } from "./core/http.js";
import { parseQuoteQuery, parseSymbols, normalizeSymbol } from "./modules/quotes/quote-query.js";

export function createApp({ config, repository, quotesService, scheduler, documentsService = null, documentScheduler = null }) {
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

      const fundamentalsMatch = url.pathname.match(/^\/api\/fundamentals\/([^/]+)$/);
      if (request.method === "GET" && fundamentalsMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(fundamentalsMatch[1]));
        return sendJson(response, 200, await quotesService.getFundamentals(symbol));
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
        return sendJson(response, 202, { results });
      }

      if (documentsService && request.method === "GET" && url.pathname === "/api/documents") {
        const symbols = parseSymbols(url.searchParams.get("symbols") ?? "", config.documentMaxSymbolsPerRun);
        const filters = parseDocumentFilters(url.searchParams, config.documentMaxResults);
        return sendJson(response, 200, { documents: await documentsService.listRecent(symbols, filters) });
      }

      const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/([0-9]+))?$/);
      if (documentsService && request.method === "GET" && documentMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(documentMatch[1]));
        if (documentMatch[2]) {
          return sendJson(response, 200, await documentsService.get(symbol, documentMatch[2]));
        }
        return sendJson(response, 200, await documentsService.list(symbol, parseDocumentFilters(url.searchParams, config.documentMaxResults)));
      }

      if (request.method === "GET" && url.pathname === "/api/monitored") {
        return sendJson(response, 200, { symbols: await repository.listMonitored() });
      }

      if (request.method === "POST" && url.pathname === "/api/monitored") {
        const symbols = await readMonitoredSymbols(request, config.maxTickers);
        return sendJson(response, 201, { symbols: await repository.addMonitored(symbols) });
      }

      if (request.method === "PUT" && url.pathname === "/api/monitored") {
        const symbols = await readMonitoredSymbols(request, config.maxTickers, true);
        return sendJson(response, 200, { symbols: await repository.replaceMonitored(symbols) });
      }

      const monitoredMatch = url.pathname.match(/^\/api\/monitored\/([^/]+)$/);
      if (request.method === "DELETE" && monitoredMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(monitoredMatch[1]));
        return sendJson(response, 200, { symbols: await repository.removeMonitored(symbol) });
      }

      if (request.method === "GET" && url.pathname === "/api/snapshots") {
        const requestedSymbols = url.searchParams.get("symbols");
        const symbols = requestedSymbols
          ? parseSymbols(requestedSymbols, config.maxTickers)
          : await repository.listMonitored();
        const limit = parseSnapshotLimit(url.searchParams.get("limit"));
        const results = await repository.getSnapshotsBySymbols(symbols, limit);
        return sendJson(response, 200, { results });
      }

      const snapshotsMatch = url.pathname.match(/^\/api\/snapshots\/([^/]+)$/);
      if (request.method === "GET" && snapshotsMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(snapshotsMatch[1]));
        const limit = parseSnapshotLimit(url.searchParams.get("limit"));
        return sendJson(response, 200, { symbol, snapshots: await repository.getSnapshots(symbol, limit) });
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
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
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
