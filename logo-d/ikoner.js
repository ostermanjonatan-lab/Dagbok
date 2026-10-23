// Fem förslag där bokstaven D också är en dagbok, 512×512, i appens färger
const B = '#800020', C = '#F3E6D5', D = '#5c0017', P = '#e3cdb3';
const frame = (inner, bg = B) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/>${inner}</svg>`;
// D-formen: rak rygg till vänster, rund båge till höger
const dPath = (x, y, w, h) => `M${x} ${y}h${w - h / 2}a${h / 2} ${h / 2} 0 0 1 0 ${h}H${x}z`;

module.exports = [
  {
    namn: 'Bokryggen',
    text: 'D:ets raka sida är bokens rygg och bågen är pärmen. Ett bokmärke hänger ut nedtill, så det syns att boken är i bruk.',
    svg: frame(`
      <path d="${dPath(140, 100, 260, 280)}" fill="${C}"/>
      <rect x="140" y="100" width="40" height="280" fill="${P}"/>
      <path d="M236 168h96M236 214h120M236 260h112M236 306h84" stroke="${B}" stroke-width="12" stroke-linecap="round" opacity=".3"/>
      <path d="M188 100h30v330l-15-15-15 15z" fill="${D}" stroke="${C}" stroke-width="6" stroke-linejoin="round"/>`),
  },
  {
    namn: 'Låset',
    text: 'D:et är en stängd dagbok med en rem och ett lås över bågen. Knyter an till kodlåset och till att dagboken är privat.',
    svg: frame(`
      <path d="${dPath(130, 96, 270, 320)}" fill="${C}"/>
      <rect x="130" y="96" width="44" height="320" fill="${P}"/>
      <rect x="300" y="226" width="140" height="60" rx="16" fill="${D}"/>
      <circle cx="398" cy="256" r="20" fill="${C}"/>
      <circle cx="398" cy="251" r="6" fill="${D}"/>
      <path d="M394 254h8l2 12h-12z" fill="${D}"/>`),
  },
  {
    namn: 'Hundörat',
    text: 'Ett D-format blad med ett vikt hörn och några rader skrift. Ser ut som en sida man vikt för att hitta tillbaka.',
    svg: frame(`
      <path d="M140 100h116a156 156 0 0 1 0 312H200l-60-60z" fill="${C}"/>
      <path d="M140 352h60v60z" fill="${P}"/>
      <path d="M140 352l60 60" stroke="${D}" stroke-width="4" opacity=".4"/>
      <path d="M186 186h120M186 236h150M186 286h130" stroke="${B}" stroke-width="14" stroke-linecap="round" opacity=".45"/>`),
  },
  {
    namn: 'Årsringarna',
    text: 'D i D i D, som sidor eller år som läggs på varandra. Den innersta är dagens sida.',
    svg: frame(`
      <path d="${dPath(120, 96, 280, 320)}" fill="none" stroke="${C}" stroke-width="22" stroke-linejoin="round"/>
      <path d="${dPath(170, 152, 190, 208)}" fill="none" stroke="${C}" stroke-width="22" stroke-linejoin="round" opacity=".75"/>
      <path d="${dPath(220, 206, 100, 100)}" fill="${C}"/>`),
  },
  {
    namn: 'Pennspetsen',
    text: 'Ett helt D där hålet i bokstaven är en reservoarpennas spets. Bokstaven och skrivandet i samma form.',
    svg: frame(`
      <path d="${dPath(136, 96, 270, 320)}" fill="${C}"/>
      <path d="M262 176c42 22 64 58 64 92l-62 82-62-82c0-34 20-70 60-92z" fill="${B}"/>
      <path d="M264 262v86" stroke="${C}" stroke-width="8" stroke-linecap="round"/>
      <circle cx="264" cy="254" r="14" fill="${C}"/>`),
  },
];
