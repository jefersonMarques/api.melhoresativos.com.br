export function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseBrazilianNumber(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, "")
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toIsoDateFromUnix(timestamp) {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : null;
}

export function calculateChange(current, previous) {
  if (current === null || previous === null || previous === 0) {
    return { change: null, percent: null };
  }

  const change = current - previous;
  return {
    change,
    percent: (change / previous) * 100
  };
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
