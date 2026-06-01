import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

test("exposes the Brapi compatible quote route", async () => {
  const handler = createApp({
    config: {
      maxTickers: 20,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 120,
      corsOrigins: []
    },
    repository: {},
    scheduler: { run: async () => {} },
    quotesService: {
      getQuotes: async (symbols, query) => ({
        results: [{ symbol: symbols[0], regularMarketPrice: 42 }],
        requestedAt: "2026-05-27T18:00:00.000Z",
        took: 1,
        isStale: false
      })
    }
  });

  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/quote/PETR4?range=1mo&interval=1d`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results[0].symbol, "PETR4");
    assert.equal(body.results[0].regularMarketPrice, 42);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("stores monitored symbols only through monitored endpoints", async () => {
  let symbols = [];
  const repository = {
    listMonitored: async () => symbols,
    addMonitored: async (newSymbols) => {
      symbols = [...new Set([...symbols, ...newSymbols])].sort();
      return symbols;
    },
    replaceMonitored: async (newSymbols) => {
      symbols = [...newSymbols].sort();
      return symbols;
    },
    removeMonitored: async (symbol) => {
      symbols = symbols.filter((item) => item !== symbol);
      return symbols;
    }
  };
  const handler = createApp({
    config: {
      maxTickers: 20,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 120,
      corsOrigins: []
    },
    repository,
    scheduler: { run: async () => {} },
    quotesService: {}
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    let response = await fetch(`http://127.0.0.1:${port}/api/monitored`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "petr4" })
    });
    assert.deepEqual((await response.json()).symbols, ["PETR4"]);

    response = await fetch(`http://127.0.0.1:${port}/api/monitored`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: ["VALE3", "ITUB4"] })
    });
    assert.deepEqual((await response.json()).symbols, ["ITUB4", "VALE3"]);

    response = await fetch(`http://127.0.0.1:${port}/api/monitored`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [] })
    });
    assert.deepEqual((await response.json()).symbols, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns snapshots for multiple saved symbols and monitored defaults", async () => {
  const repository = {
    listMonitored: async () => ["PETR4", "VALE3"],
    getSnapshotsBySymbols: async (symbols, limit) => symbols.map((symbol) => ({
      symbol,
      snapshots: [{ symbol, regularMarketPrice: limit }]
    })),
    getSnapshots: async (symbol, limit) => [{ symbol, regularMarketPrice: limit }]
  };
  const handler = createApp({
    config: {
      maxTickers: 20,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 120,
      corsOrigins: []
    },
    repository,
    scheduler: { run: async () => {} },
    quotesService: {}
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    let response = await fetch(`http://127.0.0.1:${port}/api/snapshots?symbols=PETR4,ITUB4&limit=50`);
    let body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.results.map((item) => item.symbol), ["PETR4", "ITUB4"]);
    assert.equal(body.results[0].snapshots[0].regularMarketPrice, 50);

    response = await fetch(`http://127.0.0.1:${port}/api/snapshots?limit=100`);
    body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.results.map((item) => item.symbol), ["PETR4", "VALE3"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects invalid snapshot limits", async () => {
  const handler = createApp({
    config: {
      maxTickers: 20,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 120,
      corsOrigins: []
    },
    repository: { getSnapshotsBySymbols: async () => [] },
    scheduler: { run: async () => {} },
    quotesService: {}
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/snapshots?symbols=PETR4&limit=nope`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "BAD_REQUEST");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("exposes fundamentals and official document endpoints", async () => {
  const handler = createApp({
    config: {
      maxTickers: 20,
      documentMaxSymbolsPerRun: 20,
      documentMaxResults: 100,
      cvmFiiEnabled: true,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 120,
      corsOrigins: []
    },
    repository: { listMonitored: async () => ["CACR11"] },
    scheduler: { run: async () => {} },
    quotesService: { getFundamentals: async (symbol) => ({ symbol, source: "fundamentus", metrics: { priceToBook: 0.9 } }) },
    documentsService: {
      sync: async (symbols) => symbols.map((symbol) => ({ symbol, status: "success" })),
      list: async (symbol) => ({ symbol, documents: [{ id: "1", source: "cvm_open_data" }] }),
      listRecent: async (symbols) => symbols.map((symbol) => ({ symbol, source: "cvm_open_data" })),
      get: async (symbol, id) => ({ symbol, id, content: { extractionStatus: "extracted" } })
    }
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    let response = await fetch(`http://127.0.0.1:${port}/api/fundamentals/CACR11`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).source, "fundamentus");
    response = await fetch(`http://127.0.0.1:${port}/api/documents/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: ["CACR11"] }) });
    assert.equal(response.status, 202);
    response = await fetch(`http://127.0.0.1:${port}/api/documents/CACR11?limit=20`);
    assert.equal((await response.json()).documents[0].source, "cvm_open_data");
    response = await fetch(`http://127.0.0.1:${port}/api/documents?symbols=CACR11&limit=20`);
    assert.equal((await response.json()).documents[0].symbol, "CACR11");
    response = await fetch(`http://127.0.0.1:${port}/api/documents/CACR11/1`);
    assert.equal((await response.json()).content.extractionStatus, "extracted");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
