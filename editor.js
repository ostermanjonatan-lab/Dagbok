'use strict';

// Skrivytan. Texten sparas som Markdown: # och ## för rubriker, - och 1. för listor,
// **fet** och *kursiv*. Varje rad blir ett eget stycke.
const Paper = (() => {
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?=[^\s*])([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function mdToHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '';
    let list = null;
    const close = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    const item = (tag, text) => {
      if (list !== tag) {
        close();
        html += `<${tag}>`;
        list = tag;
      }
      html += `<li>${inline(text) || '<br>'}</li>`;
    };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { item('ul', m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { item('ol', m[1]); continue; }
      close();
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        const tag = m[1].length === 1 ? 'h2' : 'h3';
        html += `<${tag}>${inline(m[2]) || '<br>'}</${tag}>`;
      } else {
        html += line.trim() ? `<p>${inline(line)}</p>` : '<p><br></p>';
      }
    }
    close();
    return html;
  }

  // Ren text utan Markdown-tecken, för sökning och korta utdrag.
  function mdToText(md) {
    return String(md || '').split('\n')
      .map((l) => l.replace(/^(#{1,6}|\s*[-*+]|\s*\d+[.)])\s+/, ''))
      .join('\n')
      .replace(/\*\*(?=\S)(.+?)\*\*/g, '$1')
      .replace(/(^|[^*])\*(?=[^\s*])([^*]+?)\*(?!\*)/g, '$1$2');
  }

  /* Från redigeraren tillbaka till Markdown */

  function wrap(s, mark) {
    if (!s.trim()) return s;
    const lead = s.match(/^\s*/)[0];
    const tail = s.match(/\s*$/)[0];
    return lead + mark + s.trim() + mark + tail;
  }

  function inlineMd(node) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        out += n.data.replace(/​/g, '').replace(/ /g, ' ');
      } else if (n.nodeType === 1) {
        const t = n.tagName;
        if (t === 'BR') out += '\n';
        else if (t === 'STRONG' || t === 'B') out += wrap(inlineMd(n), '**');
        else if (t === 'EM' || t === 'I') out += wrap(inlineMd(n), '*');
        else if (t !== 'UL' && t !== 'OL') out += inlineMd(n);
      }
    }
    return out;
  }

  const oneLine = (n) => inlineMd(n).replace(/\n+/g, ' ').trim();
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE)$/;

  function htmlToLines(root) {
    const lines = [];
    let loose = [];
    const para = (el) => {
      inlineMd(el).replace(/\n$/, '').split('\n').forEach((l) => lines.push(l));
    };
    const flush = () => {
      if (!loose.length) return;
      const p = document.createElement('p');
      loose.forEach((n) => p.appendChild(n.cloneNode(true)));
      para(p);
      loose = [];
    };
    for (const n of root.childNodes) {
      if (n.nodeType !== 1 || !BLOCK.test(n.tagName)) {
        loose.push(n);
        continue;
      }
      flush();
      const t = n.tagName;
      if (t === 'H1' || t === 'H2') {
        lines.push('# ' + oneLine(n));
      } else if (/^H[3-6]$/.test(t)) {
        lines.push('## ' + oneLine(n));
      } else if (t === 'UL' || t === 'OL') {
        let i = 1;
        for (const li of n.querySelectorAll('li')) {
          lines.push((t === 'UL' ? '- ' : `${i++}. `) + oneLine(li));
        }
      } else if ([...n.children].some((c) => BLOCK.test(c.tagName))) {
        lines.push(...htmlToLines(n));
      } else {
        para(n);
      }
    }
    flush();
    return lines;
  }

  function htmlToMd(root) {
    const lines = htmlToLines(root);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
  }

  /* Redigeraren */

  function createEditor(el, bar, onChange) {
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    const exec = (cmd, value) => document.execCommand(cmd, false, value);
    const sel = () => window.getSelection();

    // Stycket där markören står, närmast under redigeraren
    function block() {
      const s = sel();
      if (!s.rangeCount) return null;
      let n = s.anchorNode;
      while (n && n.parentNode !== el) n = n.parentNode;
      return n && n.nodeType === 1 ? n : null;
    }

    function inside(tag) {
      let n = sel().anchorNode;
      while (n && n !== el) {
        if (n.nodeName === tag) return true;
        n = n.parentNode;
      }
      return false;
    }

    function caretAtStart(b) {
      const s = sel();
      if (!s.rangeCount) return false;
      const r = document.createRange();
      r.setStart(b, 0);
      r.setEnd(s.anchorNode, s.anchorOffset);
      return r.toString().replace(/​/g, '') === '';
    }

    function setCaret(node, offset) {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel().removeAllRanges();
      sel().addRange(r);
    }

    function firstText(n) {
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      return w.nextNode();
    }

    // Gör stycket till en lista, eller lägger det sist i listan ovanför
    function makeList(b, tag) {
      const prev = b.previousElementSibling;
      const list = prev && prev.tagName === tag.toUpperCase() ? prev : document.createElement(tag);
      const li = document.createElement('li');
      while (b.firstChild) li.appendChild(b.firstChild);
      if (!li.firstChild) li.innerHTML = '<br>';
      list.appendChild(li);
      if (list === prev) b.remove();
      else b.replaceWith(list);
      const t = firstText(li);
      if (t) setCaret(t, 0);
      else setCaret(li, 0);
      el.dispatchEvent(new InputEvent('input', { inputType: 'formatBlock' }));
    }

    // "# ", "## ", "- " och "1. " i början av en rad
    function blockShortcut() {
      const s = sel();
      const node = s.anchorNode;
      if (!node || node.nodeType !== 3) return false;
      const b = block();
      if (!b || !/^(P|DIV)$/.test(b.tagName) || firstText(b) !== node) return false;
      const pre = node.data.slice(0, s.anchorOffset);
      const m = pre.match(/^(##?|[-*+]|1[.)])[  ]$/);
      if (!m) return false;
      node.data = node.data.slice(pre.length);
      // En tom textnod förvirrar webbläsaren, så tomma rader får en radbrytning
      if (!b.textContent) {
        b.innerHTML = '<br>';
        setCaret(b, 0);
      } else {
        setCaret(node, 0);
      }
      if (m[1] === '#') exec('formatBlock', 'h2');
      else if (m[1] === '##') exec('formatBlock', 'h3');
      else makeList(b, /^1/.test(m[1]) ? 'ol' : 'ul');
      return true;
    }

    // **fet** och *kursiv* när den avslutande stjärnan skrivs
    function inlineShortcut() {
      const s = sel();
      const node = s.anchorNode;
      if (!node || node.nodeType !== 3) return false;
      const pre = node.data.slice(0, s.anchorOffset);
      let tag = 'strong';
      let m = pre.match(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/);
      if (!m) {
        tag = 'em';
        m = pre.match(/(?:^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/);
      }
      if (!m) return false;
      const inner = m[1];
      const start = pre.length - inner.length - (tag === 'strong' ? 4 : 2);
      node.splitText(s.anchorOffset);
      const marked = node.splitText(start);
      const w = document.createElement(tag);
      w.textContent = inner;
      marked.replaceWith(w);
      // Ett osynligt tecken efter så att man fortsätter skriva utan formatering
      const gap = document.createTextNode('​');
      w.after(gap);
      setCaret(gap, 1);
      return true;
    }

    function ensureBlocks() {
      if (!el.firstChild || (el.childNodes.length === 1 && el.firstChild.nodeName === 'BR')) {
        el.innerHTML = '<p><br></p>';
        setCaret(el.firstChild, 0);
      } else if (el.firstChild.nodeType === 3) {
        exec('formatBlock', 'p');
      }
    }

    function markEmpty() {
      el.classList.toggle('empty', !el.textContent.replace(/​/g, '').trim() &&
        !el.querySelector('li, h2, h3'));
    }

    function updateBar() {
      if (!bar) return;
      for (const b of bar.querySelectorAll('button')) {
        const c = b.dataset.cmd;
        let on = false;
        try {
          // Rubriker är feta i sig och räknas inte som fetstil
          if (c === 'bold') on = document.queryCommandState(c) && !/^H/.test((block() || {}).tagName);
          else if (c === 'italic') on = document.queryCommandState(c);
          else if (c === 'h2') on = /^H[23]$/.test((block() || {}).tagName);
          else if (c === 'ul') on = inside('UL');
        } catch {}
        b.setAttribute('aria-pressed', String(on));
      }
    }

    const changed = () => {
      markEmpty();
      updateBar();
      onChange();
    };

    el.addEventListener('input', (ev) => {
      if (ev.inputType === 'insertText' && ev.data) {
        if (/^[  ]$/.test(ev.data)) blockShortcut();
        else if (ev.data === '*') inlineShortcut();
      }
      ensureBlocks();
      changed();
    });

    el.addEventListener('keydown', (ev) => {
      const mod = (ev.metaKey || ev.ctrlKey) && !ev.altKey;
      if (mod && /^[bi]$/i.test(ev.key)) {
        ev.preventDefault();
        exec(ev.key.toLowerCase() === 'b' ? 'bold' : 'italic');
        changed();
        return;
      }
      if (ev.key === 'Backspace' && sel().isCollapsed) {
        // Backsteg först i en rubrik gör den till vanlig text igen
        const b = block();
        if (b && /^H[1-6]$/.test(b.tagName) && caretAtStart(b)) {
          ev.preventDefault();
          exec('formatBlock', 'p');
          changed();
        }
      }
    });

    el.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
      if (/\n/.test(text)) exec('insertHTML', mdToHtml(text));
      else exec('insertText', text);
    });

    if (bar) {
      // Knapparna får inte ta fokus från texten
      const keep = (ev) => { if (ev.target.closest('button')) ev.preventDefault(); };
      bar.addEventListener('pointerdown', keep);
      bar.addEventListener('mousedown', keep);
      bar.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        if (document.activeElement !== el) el.focus();
        const c = btn.dataset.cmd;
        if (c === 'h2') {
          exec('formatBlock', /^H[23]$/.test((block() || {}).tagName) ? 'p' : 'h2');
        } else if (c === 'ul') {
          exec('insertUnorderedList');
        } else {
          exec(c);
        }
        changed();
      });
    }

    document.addEventListener('selectionchange', () => {
      if (document.activeElement === el) updateBar();
    });

    // Bottenmenyn göms när tangentbordet är uppe på telefonen
    function place() {
      const vv = window.visualViewport;
      if (!vv) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.body.classList.toggle('keyboard', kb > 80);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', place);
      window.visualViewport.addEventListener('scroll', place);
    }

    el.addEventListener('focus', () => {
      document.body.classList.add('editing');
      place();
      updateBar();
    });
    el.addEventListener('blur', () => document.body.classList.remove('editing', 'keyboard'));

    return {
      get: () => htmlToMd(el).replace(/\s+$/, ''),
      set(md) {
        el.innerHTML = mdToHtml(md) || '<p><br></p>';
        markEmpty();
      },
      focused: () => document.activeElement === el,
    };
  }

  // Markerar sökträffar i redan renderad text
  function highlight(root, q) {
    if (!q) return;
    const lq = q.toLowerCase();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let n;
    while ((n = w.nextNode())) if (n.data.toLowerCase().includes(lq)) hits.push(n);
    for (const t of hits) {
      const frag = document.createDocumentFragment();
      let rest = t.data;
      let i;
      while ((i = rest.toLowerCase().indexOf(lq)) !== -1) {
        frag.append(rest.slice(0, i));
        const mark = document.createElement('mark');
        mark.textContent = rest.slice(i, i + q.length);
        frag.append(mark);
        rest = rest.slice(i + q.length);
      }
      frag.append(rest);
      t.replaceWith(frag);
    }
  }

  return { mdToHtml, mdToText, createEditor, highlight };
})();
