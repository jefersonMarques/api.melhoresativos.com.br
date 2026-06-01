import { fetchText } from "../../core/http.js";

export class BrFiisFnetDiscoveryProvider {
  constructor({ baseUrl, timeoutMs, maximumDocuments = 40, fetchTextFn = fetchText }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.maximumDocuments = maximumDocuments;
    this.fetchTextFn = fetchTextFn;
  }

  async discover(symbol) {
    const listUrl = `${this.baseUrl}/fundos/${encodeURIComponent(symbol)}/documentos`;
    const html = await this.fetchTextFn(listUrl, { timeoutMs: this.timeoutMs });
    const links = extractDocumentLinks(html, symbol, this.baseUrl).slice(0, this.maximumDocuments);
    const documents = [];
    const failures = [];
    for (const link of links) {
      try {
        const detailHtml = await this.fetchTextFn(link.url, { timeoutMs: this.timeoutMs });
        documents.push(parseDetail({ symbol, id: link.id, url: link.url, html: detailHtml }));
      } catch (error) {
        failures.push({ sourceUrl: link.url, message: error.message });
      }
    }
    return { documents, failures, sourceUrl: listUrl };
  }
}

export function extractDocumentLinks(html, symbol, baseUrl) {
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`href=["']([^"']*\\/fundos\\/${escapedSymbol}\\/documentos\\/[^"']*-([0-9]+)(?:[?/#][^"']*)?)["']`, "gi");
  const seen = new Set();
  const links = [];
  for (const match of html.matchAll(expression)) {
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    links.push({ id: match[2], url: new URL(match[1], baseUrl).toString() });
  }
  return links;
}

function parseDetail({ symbol, id, url, html }) {
  const text = normalizeText(stripHtml(html));
  const title = firstMatch(text, [
    /(?:^|\n)(Relatório Gerencial|Fato Relevante|Comunicado ao Mercado|Rendimentos e Amortizações|Aviso aos Cotistas)(?:\n|\s)/i,
    /(?:^|\n)([^\n]{5,120})(?:\nAtivo|\nReferência)/i
  ]) ?? `Documento oficial ${symbol}`;
  const category = firstMatch(text, [/Categoria\s+([^\n]+)/i]);
  const type = firstMatch(text, [/Tipo\s+([^\n]+)/i]) ?? title;
  const referenceDate = parseBrazilianDate(firstMatch(text, [/Referência\s+(\d{2}\/\d{2}\/\d{4})/i, /Data Referência\s+(\d{2}\/\d{2}\/\d{4})/i]));
  const deliveryDate = parseBrazilianDateTime(firstMatch(text, [/Entrega\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i, /Data Entrega\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i]));
  return { id, symbol, title, category, type, referenceDate, publishedAt: deliveryDate, discoveryUrl: url };
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeText(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function parseBrazilianDate(value) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function parseBrazilianDateTime(value) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00` : null;
}
