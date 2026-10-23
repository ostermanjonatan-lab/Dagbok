const fs = require('fs');
const logos = require('./ikoner.js');
logos.forEach((l, i) => fs.writeFileSync(`${i + 1}-${l.namn.toLowerCase().replace(/[^a-zåäö]/g, '')}.svg`, l.svg.trim()));
const card = (l, i) => `
<article>
  <div class="big">${l.svg}</div>
  <div class="info">
    <div class="word"><span class="small">${l.svg}</span><span>Daysake</span></div>
    <h2>${i + 1}. ${l.namn}</h2>
    <p>${l.text}</p>
    <div class="sizes"><span class="s48">${l.svg}</span><span class="s32">${l.svg}</span><span class="dark">${l.svg}</span></div>
  </div>
</article>`;
fs.writeFileSync('ark.html', `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#F3E6D5;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#2a1418;padding:28px}
h1{font-family:Georgia,serif;color:#800020;margin:0 0 20px;font-size:30px}
article{display:flex;gap:24px;align-items:center;padding:18px 0;border-top:1px solid #e0cfbb}
.big svg{width:150px;height:150px;display:block;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .12))}
.word{display:flex;align-items:center;gap:10px;font-family:Georgia,serif;font-size:30px;font-weight:700;color:#800020}
.word svg{width:40px;height:40px;display:block}
h2{font-size:17px;margin:10px 0 2px}
p{margin:0;color:#6e5954;font-size:15px;max-width:440px}
.sizes{display:flex;align-items:center;gap:12px;margin-top:10px}
.s48 svg{width:48px;height:48px;display:block}.s32 svg{width:32px;height:32px;display:block}
.dark{background:#1e1214;padding:8px;border-radius:12px}.dark svg{width:40px;height:40px;display:block}
</style><h1>Daysake, logotypförslag</h1>${logos.map(card).join('')}`);
