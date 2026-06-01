import { AppError } from "./errors.js";

export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new AppError(
      response.status === 429 ? 503 : 502,
      "UPSTREAM_ERROR",
      `Fonte externa retornou HTTP ${response.status}`
    );
  }

  return response.json();
}

export async function fetchBuffer(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new AppError(
      response.status === 429 ? 503 : 502,
      "UPSTREAM_ERROR",
      `Fonte externa retornou HTTP ${response.status}`
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new AppError(
      response.status === 429 ? 503 : 502,
      "UPSTREAM_ERROR",
      `Fonte externa retornou HTTP ${response.status}`
    );
  }

  const buffer = await response.arrayBuffer();
  return new TextDecoder("windows-1252").decode(buffer);
}

async function fetchWithTimeout(url, { timeoutMs = 12_000, headers = {}, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarketDataApi/1.0)",
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        ...headers
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError(504, "UPSTREAM_TIMEOUT", "Tempo limite excedido ao consultar a fonte externa");
    }

    throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Não foi possível consultar a fonte externa");
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonBody(request, maximumBytes = 32_768) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Corpo da requisição excede o limite permitido");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "BAD_REQUEST", "JSON inválido");
  }
}
