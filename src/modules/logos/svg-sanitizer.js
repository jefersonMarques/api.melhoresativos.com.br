const MAX_SVG_BYTES = 200_000;
const BLOCKED_PATTERNS = [
  /<script[\s>]/i,
  /<foreignObject[\s>]/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /javascript:/i,
  /\son[a-z]+\s*=/i
];

export function sanitizeSvgContent(content) {
  const svgContent = String(content ?? '').trim();

  if (!svgContent.startsWith('<svg') || !svgContent.includes('</svg>')) {
    return null;
  }

  if (Buffer.byteLength(svgContent, 'utf8') > MAX_SVG_BYTES) {
    return null;
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(svgContent))) {
    return null;
  }

  return svgContent;
}
