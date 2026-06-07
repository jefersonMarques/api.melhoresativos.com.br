import { createHash } from "node:crypto";
import { fetchBuffer } from "../../core/http.js";

export class FnetFiiProvider {
  constructor({ baseUrl, timeoutMs, discoveryProvider, pdfTextExtractor, fetchBufferFn = fetchBuffer }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.discoveryProvider = discoveryProvider;
    this.pdfTextExtractor = pdfTextExtractor;
    this.fetchBufferFn = fetchBufferFn;
  }

  async fetchDocuments(symbol) {
    const discovered = await this.discoveryProvider.discover(symbol);
    const documents = [];
    const failures = [...discovered.failures];
    for (const item of discovered.documents) {
      const officialUrl = `${this.baseUrl}/exibirDocumento?cvm=true&id=${encodeURIComponent(item.id)}`;
      try {
        const buffer = await this.fetchBufferFn(officialUrl, { timeoutMs: this.timeoutMs, headers: { Accept: "application/pdf,text/html,*/*;q=0.8" } });
        const htmlContent = createOfficialHtmlContent(buffer);
        const invalidPdfContent = htmlContent ? null : createInvalidPdfContent(buffer);
        const content = htmlContent ?? invalidPdfContent ?? await this.pdfTextExtractor.extract(buffer);
        const contentTitle = htmlContent?.metadata?.htmlTitle;
        const title = isUsefulTitle(item.title, symbol) ? item.title : contentTitle ?? item.title;
        const typeValue = [contentTitle, item.type, title].filter(Boolean).join(" ");
        documents.push({
          symbol,
          assetType: "fii",
          documentType: mapDocumentType(typeValue),
          title,
          referenceDate: item.referenceDate,
          publishedAt: item.publishedAt,
          source: "fundosnet_b3",
          sourceDocumentId: item.id,
          sourceUrl: officialUrl,
          downloadUrl: officialUrl,
          mimeType: htmlContent ? "text/html" : "application/pdf",
          contentHash: invalidPdfContent ? null : createHash("sha256").update(buffer).digest("hex"),
          metadata: {
            official: true,
            category: item.category,
            type: item.type,
            discoveryProvider: "brfiis_public_index",
            discoveryUrl: item.discoveryUrl,
            discoveryOnly: true,
            ...(htmlContent?.metadata ?? {})
          },
          processingStatus: content.extractionStatus === "failed" ? "failed" : content.extractionStatus,
          processingError: content.extractionError ?? null,
          content: invalidPdfContent ? undefined : content
        });
      } catch (error) {
        failures.push({ sourceUrl: officialUrl, message: error.message });
      }
    }
    return { source: "fundosnet_b3", documents, failures };
  }
}

export function mapDocumentType(value = "") {
  const normalized = value.toLowerCase();
  if (normalized.includes("pagamento de proventos") || normalized.includes("rendimento") || normalized.includes("amortiza")) return "income_announcement";
  if (normalized.includes("relatório gerencial") || normalized.includes("relatorio gerencial")) return "fii_management_report";
  if (normalized.includes("fato relevante")) return "material_fact";
  if (normalized.includes("comunicado")) return "market_announcement";
  if (normalized.includes("subscr") || normalized.includes("emiss")) return "subscription_issuance";
  if (normalized.includes("assembleia")) return "shareholder_meeting";
  return "other_official_document";
}

function createOfficialHtmlContent(buffer) {
  const text = buffer.toString("utf8", 0, Math.min(buffer.length, 300_000));
  if (!looksLikeHtml(text)) return null;

  const title = extractTitleFromText(text);
  const normalizedTitle = title.toLowerCase();
  const maintenanceTitles = ["sistema indisponível", "sistema indisponivel", "erro", "error"];
  if (maintenanceTitles.some((value) => normalizedTitle.includes(value))) {
    return null;
  }

  const rawText = normalizeFundosNetIncomeText(normalizeHtmlText(stripHtml(text)));
  if (!rawText || !isOfficialFnetHtml(rawText, title)) {
    return null;
  }

  return {
    rawText,
    extractionStatus: "extracted",
    extractionError: null,
    extractedAt: new Date().toISOString(),
    metadata: {
      htmlTitle: title,
      htmlDocument: true
    }
  };
}

function createInvalidPdfContent(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.subarray(0, 4).toString("utf8") === "%PDF") {
    return null;
  }

  const title = extractTitle(buffer);
  return {
    rawText: null,
    extractionStatus: "failed",
    extractionError: title
      ? `Downloaded document is not a valid PDF. Source returned HTML: ${title}`
      : "Downloaded document is not a valid PDF",
    extractedAt: null
  };
}

function isUsefulTitle(title, symbol) {
  const value = String(title ?? "").trim().toLowerCase();
  return value && value !== `documento oficial ${String(symbol).toLowerCase()}`;
}

function looksLikeHtml(value) {
  return value.trimStart().toLowerCase().startsWith("<html") || value.toLowerCase().includes("<body");
}

function isOfficialFnetHtml(rawText, title) {
  const text = `${title}\n${rawText}`.toLowerCase();
  return text.includes("informações sobre pagamento de proventos")
    || text.includes("informacoes sobre pagamento de proventos")
    || text.includes("nome do fundo")
    || text.includes("código de negociação");
}

function extractTitle(buffer) {
  return extractTitleFromText(buffer.toString("utf8", 0, Math.min(buffer.length, 4000)));
}

function extractTitleFromText(content) {
  const normalized = content.toLowerCase();
  const opening = normalized.indexOf("<title>");
  const closing = normalized.indexOf("</title>");
  if (opening === -1 || closing === -1 || closing <= opening) {
    return null;
  }

  return normalizeHtmlText(content.slice(opening + 7, closing));
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
}

function normalizeHtmlText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function normalizeFundosNetIncomeText(value) {
  return value
    .replace(/Data-base[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/i, "Data com $1")
    .replace(/Valor do provento[\s\S]{0,120}?([0-9]+,[0-9]{2,8})/i, "Valor do rendimento R$ $1 por cota")
    .replace(/Data do pagamento[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/i, "Data do pagamento $1");
}
