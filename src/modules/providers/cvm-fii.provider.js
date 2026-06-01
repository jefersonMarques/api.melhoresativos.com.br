import { createHash } from "node:crypto";
import { fetchBuffer } from "../../core/http.js";
import { extractZipEntries } from "../documents/archive.util.js";
import { normalizeFieldName, parseDelimitedText } from "../documents/csv.util.js";

const REPORT_TYPES = [
  { key: "INF_MENSAL", documentType: "fii_monthly_report", title: "Informe Mensal Estruturado" },
  { key: "INF_TRIMESTRAL", documentType: "fii_quarterly_report", title: "Informe Trimestral Estruturado" },
  { key: "INF_ANUAL", documentType: "fii_annual_report", title: "Informe Anual Estruturado" }
];

export class CvmFiiProvider {
  constructor({ baseUrl, timeoutMs, lookbackYears = 2, currentYear = new Date().getUTCFullYear(), archiveCacheTtlMs = 6 * 60 * 60_000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.lookbackYears = lookbackYears;
    this.currentYear = currentYear;
    this.archiveCacheTtlMs = archiveCacheTtlMs;
    this.archiveCache = new Map();
  }

  async fetchDocuments(symbol, knownIdentity = null) {
    const documents = [];
    let resolvedIdentity = knownIdentity;
    const failures = [];
    for (const reportType of REPORT_TYPES) {
      const initialYear = reportType.key === "INF_ANUAL" ? this.currentYear - 1 : this.currentYear;
      const years = Array.from({ length: this.lookbackYears }, (_, index) => initialYear - index);
      for (const year of years) {
        const sourceUrl = this.#buildDatasetUrl(reportType.key, year);
        try {
          const archive = await this.#fetchArchive(sourceUrl);
          const result = this.#readOfficialRows({ archive, sourceUrl, symbol, identity: resolvedIdentity, reportType });
          documents.push(...result.documents);
          resolvedIdentity = result.identity ?? resolvedIdentity;
        } catch (error) {
          failures.push({ sourceUrl, message: error.message });
        }
      }
    }

    return { documents, identity: resolvedIdentity, failures };
  }

  async #fetchArchive(sourceUrl) {
    const cached = this.archiveCache.get(sourceUrl);
    if (cached && Date.now() - cached.fetchedAt < this.archiveCacheTtlMs) {
      return cached.archive;
    }
    const archive = await fetchBuffer(sourceUrl, { timeoutMs: this.timeoutMs });
    this.archiveCache.set(sourceUrl, { archive, fetchedAt: Date.now() });
    return archive;
  }

  #readOfficialRows({ archive, sourceUrl, symbol, identity, reportType }) {
    const targetCnpj = onlyDigits(identity?.cnpj);
    const groups = new Map();
    let inferredIdentity = identity;
    const entries = extractZipEntries(archive).filter((entry) => entry.name.toLowerCase().endsWith(".csv"));

    for (const entry of entries) {
      const csv = new TextDecoder("windows-1252").decode(entry.content);
      for (const row of parseDelimitedText(csv)) {
        const normalized = normalizeRow(row);
        if (!matchesAsset(normalized, symbol, targetCnpj)) {
          continue;
        }
        const referenceDate = findReferenceDate(normalized);
        const cnpj = findValue(normalized, ["CNPJ_FUNDO", "CNPJ_DO_FUNDO", "CNPJ"]);
        const fundName = findValue(normalized, ["DENOMINACAO_SOCIAL", "DENOM_SOCIAL", "NOME_FUNDO", "DENOMINACAO_DO_FUNDO"]);
        if (!inferredIdentity && cnpj) {
          inferredIdentity = {
            symbol,
            assetType: "fii",
            cnpj: formatCnpj(cnpj),
            fundName: fundName || null,
            sourceMetadata: { resolutionSource: "cvm_structured_report", sourceUrl },
            resolutionStatus: "resolved"
          };
        }
        const key = `${referenceDate ?? String(this.currentYear)}:${reportType.documentType}`;
        const current = groups.get(key) ?? { referenceDate, rows: [], files: new Set() };
        current.rows.push(row);
        current.files.add(entry.name);
        groups.set(key, current);
      }
    }

    const documents = [...groups.values()].map((group) => {
      const text = JSON.stringify({ files: [...group.files], rows: group.rows });
      const externalKey = `${symbol}:${reportType.documentType}:${group.referenceDate ?? this.currentYear}`;
      return {
        symbol,
        assetType: "fii",
        documentType: reportType.documentType,
        title: `${reportType.title}${group.referenceDate ? ` - ${group.referenceDate}` : ""}`,
        referenceDate: group.referenceDate,
        publishedAt: null,
        source: "cvm_open_data",
        sourceDocumentId: externalKey,
        sourceUrl,
        downloadUrl: sourceUrl,
        mimeType: "application/zip",
        contentHash: createHash("sha256").update(text).digest("hex"),
        metadata: { official: true, rowCount: group.rows.length, archiveFiles: [...group.files] },
        processingStatus: "extracted",
        content: { rawText: text, extractionStatus: "extracted", extractedAt: new Date().toISOString() }
      };
    });

    return { documents, identity: inferredIdentity };
  }

  #buildDatasetUrl(reportType, year) {
    const filenamePrefix = reportType.toLowerCase();
    return `${this.baseUrl}/dados/FII/DOC/${reportType}/DADOS/${filenamePrefix}_fii_${year}.zip`;
  }
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeFieldName(key), String(value).trim()]));
}

function matchesAsset(row, symbol, targetCnpj) {
  if (targetCnpj && Object.values(row).some((value) => onlyDigits(value) === targetCnpj)) {
    return true;
  }
  return Object.values(row).some((value) => value.toUpperCase().replace(/\s/g, "") === symbol);
}

function findReferenceDate(row) {
  const raw = findValue(row, ["DATA_REFERENCIA", "DT_REFERENCIA", "DATA_DE_REFERENCIA", "DT_COMPTC", "DATA_COMPETENCIA"]);
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const month = raw.match(/^(\d{4})-(\d{2})$/);
  return month ? `${month[1]}-${month[2]}-01` : null;
}

function findValue(row, fields) {
  for (const field of fields) {
    if (row[field]) return row[field];
  }
  return null;
}

function onlyDigits(value) {
  return value ? String(value).replace(/\D/g, "") : "";
}

function formatCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
