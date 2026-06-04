export function createDefaultLogoSvg(symbol) {
  const label = normalizeLabel(symbol);
  const lines = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">',
    '<rect width="128" height="128" rx="28" fill="#0f172a"/>',
    '<circle cx="96" cy="32" r="22" fill="#1d4ed8" opacity="0.82"/>',
    '<circle cx="34" cy="98" r="24" fill="#0ea5e9" opacity="0.38"/>',
    `<text x="64" y="75" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${label}</text>`,
    '</svg>'
  ];

  return lines.join('');
}

export function createSvgDataUri(svgContent) {
  return `data:image/svg+xml;base64,${Buffer.from(svgContent, 'utf8').toString('base64')}`;
}

function normalizeLabel(symbol) {
  const value = String(symbol ?? '?').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return escapeXml(value.slice(0, 4) || '?');
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
