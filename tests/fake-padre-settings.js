// Imitación mínima del modal de ajustes de Padre (estructura real de noviembre de 2026) para las pruebas.
(() => {
  const S = window.__padreState = {
    presets: { 1: { buy: { prio: '0.001', tip: '0.01', slip: '20', mev: true }, sell: { prio: '0.001', tip: '0.01', slip: '40', mev: true } },
               2: { buy: { prio: '0.002', tip: '0.02', slip: '20', mev: true }, sell: { prio: '0.002', tip: '0.02', slip: '40', mev: true } },
               3: { buy: { prio: '0.003', tip: '0.03', slip: '20', mev: false }, sell: { prio: '0.003', tip: '0.03', slip: '40', mev: true } } },
    toggles: { 'trenches-token-audit-top-10-holders': true, 'trenches-token-audit-dev-holding': true, 'trenches-token-audit-snipers-count': true,
      'trenches-token-audit-snipers-holding': false, 'trenches-token-audit-insiders-holding': true, 'trenches-token-audit-bundles': false,
      'trenches-token-audit-tax': true, 'trenches-token-metrics-market-cap': true, 'trenches-token-metrics-volume': true, 'instant-trade-general-button-cooldown': false,
      'trenches-token-audit-dev-funded': true, 'trenches-token-audit-hover-bubble-map': false, 'trenches-token-metrics-net-buy': false, 'trenches-token-vitals-total-holders': true,
      'trenches-token-vitals-dev-created': true, 'trenches-token-vitals-fresh-wallet-buys': false,
      'orders-general-button-cooldown': false, 'orders-general-dev-sold-sound': false, 'orders-general-hide-high-tax-warning': true, 'orders-general-hide-low-liquidity-warning': true,
      'instant-trade-general-position-row': true, 'trenches-general-pause-on-hover': false, 'trenches-general-x-card-xReuse': true,
      'trenches-token-avatar-reused-warning': true, 'trenches-token-socials-reuse-warning': false,
      'market-holders-column-fundedBy': true, 'market-top-traders-column-fundedBy': false, 'market-position-remaining-basis': true },
    // Ajustes que Blankfire no debe tocar nunca (colores, idioma…).
    untouched: { 'appearance-full-numbers': false },
    open: false, section: 'Appearance', tab: '', sub: '', preset: 1, side: 'buy',
  };
  const gear = document.createElement('button');
  gear.setAttribute('aria-label', 'Settings'); gear.textContent = '⚙';
  gear.style.cssText = 'position:fixed;top:8px;right:60px;width:30px;height:30px;z-index:5';
  gear.onclick = () => { S.open = true; render(); };
  document.body.appendChild(gear);
  const wrap = document.createElement('div'); document.body.appendChild(wrap);
  // Barra de compra de Padre con el preset activo («P1 0.001 0.01 20% On»).
  S.bar = 1;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:10px;bottom:10px;display:flex;gap:6px;color:#ccc;font:12px sans-serif;z-index:4';
  document.body.appendChild(bar);
  const paintBar = () => { const c = S.presets[S.bar].buy; bar.innerHTML = `<span>P${S.bar}</span><span><span>${c.prio}</span></span><span><span>${c.tip}</span></span><span><span>${c.slip}%</span></span><span><span>${c.mev ? 'On' : 'Off'}</span></span>`; };
  window.__setBar = (n) => { S.bar = n; paintBar(); };
  setInterval(paintBar, 500); paintBar();
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  function render() {
    wrap.innerHTML = '';
    if (!S.open) return;
    const m = h(`<div id="pmodal" style="position:fixed;left:200px;top:60px;width:760px;height:620px;background:#111;color:#ddd;display:flex;z-index:10;font:13px sans-serif">
      <div style="width:200px;padding:8px;display:flex;flex-direction:column;gap:4px"><input placeholder="Search settings"><p>Display</p><p>Trading</p></div>
      <div id="pc" style="flex:1;padding:10px;display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between"><b>${S.section}</b><button aria-label="Close">×</button></div></div></div>`);
    const side = m.firstElementChild;
    for (const name of ['Appearance', 'Orders', 'Chart', 'Trenches', 'Market', 'Instant Trade']) {
      const b = h(`<button>${name}</button>`); b.onclick = () => { S.section = name; S.tab = { Orders: 'General', Trenches: 'General', Market: 'General', 'Instant Trade': 'General' }[name] || ''; S.sub = ''; render(); }; side.appendChild(b);
    }
    const pc = m.querySelector('#pc');
    m.querySelector('[aria-label="Close"]').onclick = () => { S.open = false; render(); };
    // Pestañas con id como en Padre (settings-tab-ORDERS_GENERAL) y subpestañas de Token (trenches-token-category-elements).
    const tabs = (list, key) => { const row = h('<div style="display:flex;gap:6px"></div>'); for (const t of list) { const id = key === 'tab' ? `settings-tab-${S.section.toUpperCase().replace(/ /g, '_')}_${t.toUpperCase().replace(/ /g, '_')}` : `trenches-token-category-${t.toLowerCase()}`; const b = h(`<button id="${id}">${t}</button>`); b.onclick = () => { S[key] = t; render(); }; row.appendChild(b); } pc.appendChild(row); };
    // Fila con interruptor propio (role=switch en la fila) o con el interruptor dentro.
    const swRow = (a, label, inner = false) => {
      const row = inner ? h(`<div data-settings-anchor="${a}"><span>${label}</span><button role="switch" aria-checked="${S.toggles[a]}"></button></div>`)
        : h(`<div role="switch" aria-checked="${S.toggles[a]}" data-settings-anchor="${a}"><span>${label}</span></div>`);
      (inner ? row.querySelector('button') : row).onclick = () => { S.toggles[a] = !S.toggles[a]; render(); };
      pc.appendChild(row);
    };
    const rowsWith = (prefix) => Object.keys(S.toggles).filter((a) => a.startsWith(prefix)).forEach((a) => swRow(a, a, a === 'market-position-remaining-basis'));
    if (S.section === 'Appearance') {
      const row = h(`<div role="switch" aria-checked="${S.untouched['appearance-full-numbers']}" data-settings-anchor="appearance-full-numbers">Full numbers</div>`);
      row.onclick = () => { S.untouched['appearance-full-numbers'] = !S.untouched['appearance-full-numbers']; render(); };
      pc.appendChild(row);
    } else if (S.section === 'Market') {
      tabs(['General', 'Position', 'Holders', 'Top traders'], 'tab');
      if (S.tab === 'Holders') rowsWith('market-holders-');
      if (S.tab === 'Top traders') rowsWith('market-top-traders-');
      if (S.tab === 'Position') rowsWith('market-position-');
    } else if (S.section === 'Orders') {
      tabs(['General', 'Presets', 'Execution'], 'tab');
      if (S.tab === 'General') rowsWith('orders-general-');
      if (S.tab === 'Presets') {
        const radios = h('<div style="display:flex;gap:6px"></div>');
        for (const n of [1, 2, 3]) { const r = h(`<div role="radio" aria-checked="${S.preset === n}" tabindex="0">Preset ${n}</div>`); r.onclick = () => { setTimeout(() => { S.preset = n; render(); }, 80); }; radios.appendChild(r); }
        pc.appendChild(radios);
        const sides = h('<button style="display:flex;gap:8px"><span><span>Buy settings</span></span><span><span>Sell settings</span></span></button>');
        sides.querySelectorAll('span > span').forEach((sp) => { sp.onclick = (e) => { e.stopPropagation(); S.side = /Buy/.test(sp.textContent) ? 'buy' : 'sell'; render(); }; });
        pc.appendChild(sides);
        const cur = S.presets[S.preset][S.side];
        for (const [label, key] of [['Prio', 'prio'], ['Tip', 'tip'], ['Slippage', 'slip']]) {
          const f = h(`<div><div><div><input type="text"></div><span>${label === 'Slippage' ? '%' : 'SOL'}</span></div><div><span>${label}</span></div></div>`);
          const inp = f.querySelector('input'); inp.value = cur[key];
          // Como React: el estado se actualiza con el evento input.
          inp.addEventListener('input', () => { S.presets[S.preset][S.side][key] = inp.value; });
          pc.appendChild(f);
        }
        const sw = h(`<div><span>MEV mode</span><button role="switch" aria-checked="false"><div class="_option_${cur.mev ? '_optionUnselected_1' : '_optionSelected_1'}"><span>Off</span></div><div class="_option_${cur.mev ? '_optionSelected_1' : '_optionUnselected_1'}"><span>Secure</span></div></button></div>`);
        const opts = sw.querySelectorAll('[role="switch"] > div');
        opts[0].onclick = (e) => { e.stopPropagation(); S.presets[S.preset][S.side].mev = false; render(); };
        opts[1].onclick = (e) => { e.stopPropagation(); S.presets[S.preset][S.side].mev = true; render(); };
        pc.appendChild(sw);
      }
    } else if (S.section === 'Trenches') {
      tabs(['General', 'Token'], 'tab');
      if (S.tab === 'General') rowsWith('trenches-general-');
      if (S.tab === 'Token') {
        tabs(['Layout', 'Styling', 'Elements'], 'sub');
        if (S.sub === 'Layout') { swRow('trenches-token-avatar-reused-warning', 'Avatar reuse warning'); swRow('trenches-token-socials-reuse-warning', 'Socials reuse warning'); }
        if (S.sub === 'Elements') {
          for (const [a, on] of Object.entries(S.toggles)) {
            if (!/^trenches-token-(audit|metrics|vitals)-/.test(a)) continue;
            const b = h(`<button aria-pressed="${on}" data-settings-anchor="${a}" aria-label="${a}">${a.replace('trenches-token-', '')}</button>`);
            b.onclick = () => { S.toggles[a] = !S.toggles[a]; render(); };
            pc.appendChild(b);
          }
        }
      }
    } else if (S.section === 'Instant Trade') {
      tabs(['General', 'Buttons'], 'tab');
      if (S.tab === 'General') { swRow('instant-trade-general-button-cooldown', 'Buy/sell button cooldown', true); swRow('instant-trade-general-position-row', 'Show position row'); }
    }
    wrap.appendChild(m);
  }
})();
