import { parseBrazilianNumber } from "../../utils/values.js";

const STRUCTURED_ALIASES = {
  fundType: ["TIPO_FUNDO_CLASSE", "TIPO_FUNDO", "SEGMENTO", "CLASSE"],
  netAssetValue: ["PATRIMONIO_LIQUIDO", "PATRIM_LIQ", "VL_PATRIM_LIQ", "VL_PATRIMONIO_LIQUIDO"],
  netAssetValuePerShare: ["VALOR_PATRIMONIAL_COTA", "VL_PATRIMONIAL_COTA", "VL_PATRIM_COTA", "VPA", "VL_COTA"],
  shareholdersCount: ["NUMERO_COTISTAS", "NR_COTISTAS", "QT_COTISTAS", "NUM_COTISTAS"],
  totalShares: ["QUANTIDADE_COTAS", "QT_COTAS", "QTD_COTAS", "QT_COTAS_EMITIDAS"],
  physicalVacancy: ["VACANCIA_FISICA", "PERCENTUAL_VACANCIA_FISICA", "PC_VACANCIA_FISICA"],
  financialVacancy: ["VACANCIA_FINANCEIRA", "PERCENTUAL_VACANCIA_FINANCEIRA", "PC_VACANCIA_FINANCEIRA"],
  cash: ["DISPONIBILIDADES", "CAIXA", "VL_DISPONIBILIDADES"],
  leverage: ["ALAVANCAGEM", "PC_ALAVANCAGEM"],
};

const TEXT_PATTERNS = {
  loanToValue: [/(?:LTV|loan\s*to\s*value)(?:\s*(?:m[eé]dio|m[aá]ximo))?\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  delinquency: [/(?:inadimpl[eê]ncia|cr[eé]ditos?\s+inadimplentes?|atrasos?)(?:\s*(?:total|da\s+carteira))?\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  debtorConcentration: [/(?:maior\s+(?:devedor|exposi[cç][aã]o)|concentra[cç][aã]o\s+(?:por\s+)?(?:devedor|CRI))\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  cdiExposure: [/(?:CDI|CDI\s*\+[^%\n]*)\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  ipcaExposure: [/(?:IPCA|IPCA\s*\+[^%\n]*)\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  physicalVacancy: [/(?:vac[aâ]ncia\s+f[ií]sica)\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  financialVacancy: [/(?:vac[aâ]ncia\s+financeira)\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i],
  contractDuration: [/(?:WAULT|prazo\s+m[eé]dio\s+(?:dos\s+)?contratos?)\s*[:=-]?\s*(\d{1,3}(?:[.,]\d+)?)/i],
  dividendPerShare: [/(?:rendimento|dividendo)(?:\s+por\s+cota)?\s*[:=-]?\s*R?\$?\s*(\d+(?:[.,]\d+)?)/i],
  resultPerShare: [/(?:resultado)(?:\s+por\s+cota)?\s*[:=-]?\s*R?\$?\s*(\d+(?:[.,]\d+)?)/i],
};

export function extractOfficialFiiMetrics(documents) {
  const ordered = [...documents].sort((first, second) => comparableDate(second).localeCompare(comparableDate(first)));
  const metrics = {};
  const evidence = [];
  for (const document of ordered) {
    const rawText = document?.content?.rawText;
    if (!rawText) continue;
    if (document.source === "cvm_open_data") {
      const found = extractStructuredMetrics(rawText);
      assignMissing(metrics, found);
      if (Object.keys(found).length) evidence.push(toEvidence(document, Object.keys(found)));
    }
    if (document.source === "fundosnet_b3") {
      const found = extractReportTextMetrics(rawText);
      assignMissing(metrics, found);
      if (Object.keys(found).length) evidence.push(toEvidence(document, Object.keys(found)));
    }
  }
  if (metrics.cdiExposure !== undefined || metrics.ipcaExposure !== undefined) {
    metrics.indexerExposure = {
      ...(metrics.cdiExposure !== undefined ? { cdi: metrics.cdiExposure } : {}),
      ...(metrics.ipcaExposure !== undefined ? { ipca: metrics.ipcaExposure } : {}),
    };
  }
  if (metrics.resultPerShare !== undefined && metrics.dividendPerShare > 0) {
    metrics.recurringResultCoverage = Number((metrics.resultPerShare / metrics.dividendPerShare).toFixed(4));
  }
  return {
    metrics,
    evidence,
    referenceDate: evidence[0]?.referenceDate ?? null,
    hasMetrics: Object.keys(metrics).length > 0,
  };
}

function extractStructuredMetrics(rawText) {
  let content;
  try {
    content = JSON.parse(rawText);
  } catch {
    return {};
  }
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const result = {};
  for (const [metric, aliases] of Object.entries(STRUCTURED_ALIASES)) {
    const value = findInRows(rows, aliases, metric === "fundType");
    if (value !== null) result[metric] = value;
  }
  return result;
}

function findInRows(rows, aliases, keepText) {
  const normalizedAliases = aliases.map(normalizeKey);
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (normalizedAliases.includes(normalizeKey(key)) && value !== "" && value !== null && value !== undefined) {
        return keepText ? String(value).trim() : parseNumber(value);
      }
    }
  }
  return null;
}

function extractReportTextMetrics(rawText) {
  const metrics = {};
  for (const [metric, patterns] of Object.entries(TEXT_PATTERNS)) {
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (!match) continue;
      const parsed = parseBrazilianNumber(match[1]);
      if (parsed !== null) metrics[metric] = parsed;
      break;
    }
  }
  if (/\bCRI\b|receb[ií]veis|certificado de receb|\bLTV\b/i.test(rawText)) metrics.fundType = "receivables";
  else if (/vac[aâ]ncia|locat[aá]ri|\bWAULT\b|\bABL\b|aluguel/i.test(rawText)) metrics.fundType = "brick";
  return metrics;
}

function assignMissing(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined && value !== null) target[key] = value;
  }
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseBrazilianNumber(String(value));
}

function comparableDate(document) {
  return document.referenceDate ?? document.publishedAt ?? "0000-00-00";
}

function toEvidence(document, fields) {
  return {
    documentId: String(document.id),
    documentType: document.documentType,
    source: document.source,
    sourceUrl: document.sourceUrl,
    referenceDate: document.referenceDate ?? null,
    extractedIndicators: fields,
  };
}

function normalizeKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}
