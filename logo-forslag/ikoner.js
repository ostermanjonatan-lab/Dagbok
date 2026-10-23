// Fem logotypförslag som SVG, 512×512, i appens färger
const B = '#800020', C = '#F3E6D5', D = '#5c0017';
const frame = (inner, bg = B) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/>${inner}</svg>`;
module.exports = [
  {
    namn: 'Bokmärket',
    text: 'En uppslagen bok med ett vinrött bokmärke. Tydligt dagbok, och känns igen i liten storlek.',
    svg: frame(`
      <path d="M96 150c56-22 112-22 160 8v230c-48-30-104-30-160-8z" fill="${C}"/>
      <path d="M416 150c-56-22-112-22-160 8v230c48-30 104-30 160-8z" fill="${C}"/>
      <path d="M256 158v230" stroke="${B}" stroke-width="6"/>
      <path d="M300 146h40v150l-20-18-20 18z" fill="${D}"/>`),
  },
  {
    namn: 'Monogrammet',
    text: 'Ett stort D i serif med en bläckdroppe. Lugnt och klassiskt, som ett exlibris.',
    svg: frame(`
      <text x="226" y="368" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="300" font-weight="700" fill="${C}">D</text>
      <path d="M376 292s-28 34-28 54a28 28 0 0 0 56 0c0-20-28-54-28-54z" fill="${C}"/>`),
  },
  {
    namn: 'Dagens blad',
    text: 'Ett kalenderblad med en handskriven rad. Knyter ihop kalendern och skrivandet.',
    svg: frame(`
      <rect x="120" y="112" width="272" height="300" rx="28" fill="${C}"/>
      <path d="M120 140a28 28 0 0 1 28-28h216a28 28 0 0 1 28 28v52H120z" fill="${D}"/>
      <rect x="178" y="88" width="20" height="56" rx="10" fill="${C}"/>
      <rect x="314" y="88" width="20" height="56" rx="10" fill="${C}"/>
      <path d="M158 262c22-18 40-18 52 0s30 18 48-2 36-18 50 0 28 14 46-4" fill="none" stroke="${B}" stroke-width="14" stroke-linecap="round"/>
      <path d="M158 326h150" stroke="${B}" stroke-width="14" stroke-linecap="round" opacity=".45"/>`),
  },
  {
    namn: 'Pennan',
    text: 'En penna som skriver en mjuk linje. Samma symbol som Dag-knappen i appen.',
    svg: frame(`
      <g transform="rotate(45 256 256)">
        <rect x="226" y="70" width="60" height="250" rx="10" fill="${C}"/>
        <rect x="226" y="70" width="60" height="44" rx="10" fill="${D}" stroke="${C}" stroke-width="0"/>
        <path d="M226 320h60l-30 62z" fill="${C}"/>
        <path d="M246 362h20l-10 20z" fill="${B}"/>
      </g>
      <path d="M150 392c22-22 44-22 62 0s42 22 64 0 42-22 62 0" fill="none" stroke="${C}" stroke-width="14" stroke-linecap="round"/>`),
  },
  {
    namn: 'Soluppgången',
    text: 'En sol över horisonten i en ring. Dag för dag, och ljusare i tonen än de andra.',
    svg: frame(`
      <circle cx="256" cy="256" r="150" fill="none" stroke="${C}" stroke-width="16"/>
      <path d="M176 300a80 80 0 0 1 160 0z" fill="${C}"/>
      <path d="M150 300h212" stroke="${C}" stroke-width="16" stroke-linecap="round"/>
      <path d="M256 176v-30M196 200l-20-20M316 200l20-20" stroke="${C}" stroke-width="14" stroke-linecap="round"/>
      <path d="M206 344h100" stroke="${C}" stroke-width="14" stroke-linecap="round" opacity=".6"/>`),
  },
];
