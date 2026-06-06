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
        const pdf = await this.fetchBufferFn(officialUrl, { timeoutMs: this.timeoutMs, headers: { Accept: "application/pdf,*/*;q=0.8" } });
        const invalidPdfContent = createInvalidPdfContent(pdf);
        const content = invalidPdfContent ?? await this.pdfTextExtractor.extract(pdf);
        documents.push({
          symbol,
          assetType: "fii",
          documentType: mapDocumentType(item.type ?? item.title),
          title: item.title,
          referenceDate: item.referenceDate,
          publishedAt: item.publishedAt,
          source: "fundosnet_b3",
          sourceDocumentId: item.id,
          sourceUrl: officialUrl,
          downloadUrl: officialUrl,
          mimeType: "application/pdf",
          contentHash: invalidPdfContent ? null : createHash("sha256").update(pdf).digest("hex"),
          metadata: {
            official: true,
            category: item.category,
            type: item.type,
            discoveryProvider: "brfiis_public_index",
            discoveryUrl: item.discoveryUrl,
            discoveryOnly: true
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
  if (normalized.includes("relatório gerencial") || normalized.includes("relatorio gerencial")) return "fii_management_report";
  if (normalized.includes("fato relevante")) return "material_fact";
  if (normalized.includes("comunicado")) return "market_announcement";
  if (normalized.includes("rendimento") || normalized.includes("amortiza")) return "income_announcement";
  if (normalized.includes("subscr") || normalized.includes("emiss")) return "subscription_issuance";
  if (normalized.includes("assembleia")) return "shareholder_meeting";
  return "other_official_document";
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

function extractTitle(buffer) {
  const content = buffer.toString("utf8", 0, Math.min(buffer.length, 4000));
  const normalized = content.toLowerCase();
  const opening = normalized.indexOf("<title>");
  const closing = normalized.indexOf("</title>");
  if (opening === -1 || closing === -1 || closing <= opening) {
    return null;
  }

  return normalizeHtmlText(content.slice(opening + 7, closing));
}

function normalizeHtmlText(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
