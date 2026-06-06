export function createDefaultLogoSvg(symbol) {
  return createAssetSvg(symbol);
}

export function createAssetSvg(text = 'CACR11') {
  const size = 512;
  const safeText = String(text)
    .trim()
    .toUpperCase()
    .replace(/[<>&"']/g, '');

  const match = safeText.match(/^([A-Z]+)(\d+)$/);
  const letters = match ? match[1] : safeText;
  const numbers = match ? match[2] : '';

  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${safeText}">
  <defs>
    <linearGradient id="backgroundGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#064896"/>
      <stop offset="42%" stop-color="#032f68"/>
      <stop offset="100%" stop-color="#021f43"/>
    </linearGradient>

    <linearGradient id="goldGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFE07A"/>
      <stop offset="48%" stop-color="#F6C343"/>
      <stop offset="100%" stop-color="#D89A16"/>
    </linearGradient>

    <linearGradient id="barGradient" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#0B356B" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#77A9E6" stop-opacity="0.25"/>
    </linearGradient>

    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.28"/>
    </filter>

    <filter id="innerGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.4 0 0 0 0 0.7 0 0 0 0 1 0 0 0 0.28 0"/>
      <feBlend in="SourceGraphic" mode="screen"/>
    </filter>

    <clipPath id="roundedSquare">
      <rect width="${size}" height="${size}" rx="78" ry="78"/>
    </clipPath>
  </defs>

  <g clip-path="url(#roundedSquare)">
    <rect width="${size}" height="${size}" fill="url(#backgroundGradient)"/>

    <circle cx="140" cy="44" r="210" fill="#0D5BB6" opacity="0.12" filter="url(#innerGlow)"/>
    <circle cx="420" cy="108" r="220" fill="#001A3B" opacity="0.26"/>

    <g opacity="0.82">
      <rect x="36" y="432" width="42" height="80" fill="url(#barGradient)"/>
      <rect x="106" y="398" width="42" height="114" fill="url(#barGradient)"/>
      <rect x="176" y="366" width="42" height="146" fill="url(#barGradient)"/>
      <rect x="246" y="334" width="42" height="178" fill="url(#barGradient)"/>
      <rect x="316" y="296" width="42" height="216" fill="url(#barGradient)"/>
      <rect x="386" y="252" width="42" height="260" fill="url(#barGradient)"/>
      <rect x="456" y="182" width="42" height="330" fill="url(#barGradient)"/>
    </g>

    <g filter="url(#softShadow)">
      <text x="50%" y="56%" text-anchor="middle" dominant-baseline="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="93" font-weight="900" letter-spacing="-3">
        <tspan fill="#FFFFFF">${letters}</tspan><tspan fill="url(#goldGradient)">${numbers}</tspan>
      </text>
    </g>

    <rect width="${size}" height="${size}" rx="78" ry="78" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="2"/>
  </g>
</svg>`.trim();
}

export function createSvgDataUri(svgContent) {
  return `data:image/svg+xml;base64,${Buffer.from(svgContent, 'utf8').toString('base64')}`;
}
