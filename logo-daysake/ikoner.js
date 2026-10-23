// Fem logotypförslag för Daysake, 512×512, i appens färger
const B = '#800020', C = '#F3E6D5', D = '#5c0017';
const frame = (inner, bg = B) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/>${inner}</svg>`;

// Sol med strålar, används i flera förslag
function sun(cx, cy, r, color, rays = 8, len = 0.55, width = 12) {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const r1 = r * 1.35, r2 = r * (1.35 + len);
    s += `<line x1="${cx + Math.cos(a) * r1}" y1="${cy + Math.sin(a) * r1}" x2="${cx + Math.cos(a) * r2}" y2="${cy + Math.sin(a) * r2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  }
  return s;
}

// Vågig kant som på ett lacksigill
function sealPath(cx, cy, r, bumps, depth) {
  const pts = [];
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const rr = r + depth * Math.sin(a * bumps);
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

module.exports = [
  {
    namn: 'Medaljongen',
    text: 'En medaljong, den klassiska saken man sparar ett minne i, med en sol inuti. Dagen blir något att bära med sig.',
    svg: frame(`
      <circle cx="256" cy="104" r="24" fill="none" stroke="${C}" stroke-width="14"/>
      <ellipse cx="256" cy="276" rx="128" ry="150" fill="${C}"/>
      <ellipse cx="256" cy="276" rx="100" ry="122" fill="none" stroke="${B}" stroke-width="6" opacity=".35"/>
      ${sun(256, 276, 34, B, 8, 0.5, 11)}`),
  },
  {
    namn: 'Burken',
    text: 'En glasburk med en sol i, som att samla dagar. Lekfull och lätt att förstå.',
    svg: frame(`
      <rect x="176" y="104" width="160" height="42" rx="12" fill="${D}" stroke="${C}" stroke-width="10"/>
      <path d="M168 166h176a24 24 0 0 1 24 24v178a44 44 0 0 1-44 44H188a44 44 0 0 1-44-44V190a24 24 0 0 1 24-24z" fill="${C}"/>
      <path d="M182 210v120" stroke="${B}" stroke-width="10" stroke-linecap="round" opacity=".25"/>
      ${sun(266, 296, 40, B, 8, 0.45, 11)}`),
  },
  {
    namn: 'Sigillet',
    text: 'Ett lacksigill med en soluppgång, som när man förseglar ett brev att spara. Krämvit botten för att sticka ut.',
    svg: frame(`
      <path d="${sealPath(256, 262, 168, 14, 9)}" fill="${B}"/>
      <circle cx="256" cy="262" r="128" fill="none" stroke="${C}" stroke-width="6" opacity=".5"/>
      <path d="M186 296a70 70 0 0 1 140 0z" fill="${C}"/>
      <path d="M166 296h180" stroke="${C}" stroke-width="12" stroke-linecap="round"/>
      <path d="M256 196v-26M206 216l-18-18M306 216l18-18" stroke="${C}" stroke-width="12" stroke-linecap="round"/>`, C),
  },
  {
    namn: 'Pressad blomma',
    text: 'En blomma pressad mellan sidorna, ett minne från en viss dag. Mjukast och mest personlig av förslagen.',
    svg: frame(`
      <rect x="128" y="104" width="256" height="310" rx="18" fill="${C}" transform="rotate(-6 256 259)"/>
      <path d="M256 360c-4-50 2-96 0-130" stroke="${B}" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M256 320c-30-4-48-22-52-44 26 0 46 16 52 44z" fill="${D}"/>
      <g fill="${B}">
        <circle cx="256" cy="172" r="30"/><circle cx="290" cy="198" r="30"/><circle cx="278" cy="238" r="30"/>
        <circle cx="234" cy="238" r="30"/><circle cx="222" cy="198" r="30"/>
      </g>
      <circle cx="256" cy="208" r="18" fill="${C}"/>`),
  },
  {
    namn: 'Monogrammet',
    text: 'Ett D med en soluppgång i bågen. Enkelt och kraftfullt, och fungerar även som ensam bokstav.',
    svg: frame(`
      <path d="M168 120h72a136 136 0 0 1 0 272h-72z" fill="none" stroke="${C}" stroke-width="40" stroke-linejoin="round"/>
      <path d="M200 340a58 58 0 0 1 116 0z" fill="${C}"/>
      <path d="M258 262v-26M218 278l-16-16M298 278l16-16" stroke="${C}" stroke-width="12" stroke-linecap="round"/>`),
  },
];
