// Blankfire — mini-gráficos para las tarjetas del recorrido (panel y ventana).
// Devuelven HTML; los textos llegan ya traducidos con tr() desde quien los usa.

const arrow = '<svg class="vz-arr" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h7.5M6.5 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Cifras clave: [{ k: etiqueta, v: valor, t: 'up' | 'down' | 'amber' | 'blue' }]
export function vChips(items) {
  return `<div class="vz vz-chips">${items.map((it) => `<span class="vz-chip ${it.t || ''}"><small>${it.k}</small><b>${it.v}</b></span>`).join('')}</div>`;
}

// Secuencia de pasos con flechas: [{ v, k?, t? }]
export function vFlow(items) {
  return `<div class="vz vz-flow">${items.map((it, i) => `${i ? arrow : ''}<span class="vz-step ${it.t || ''}" style="--i:${i}"><b>${it.v}</b>${it.k ? `<small>${it.k}</small>` : ''}</span>`).join('')}</div>`;
}

// Teclas: [{ keys: ['1','2'], label }]
export function vKeys(rows) {
  return `<div class="vz vz-keys">${rows.map((r) => `<span class="vz-key">${r.keys.map((k) => `<kbd>${k}</kbd>`).join('')}<em>${r.label}</em></span>`).join('')}</div>`;
}

// Barra Stop ← entrada → Take. sl y tp en %, now opcional (resultado actual en %).
export function vRange({ sl, tp, slLabel, tpLabel, entryLabel, now }) {
  const L = -sl, R = tp, x0 = (0 - L) / (R - L) * 100;
  const dot = now == null ? '' : `<i class="vz-dot ${now >= 0 ? 'up' : 'down'}" style="left:${((now - L) / (R - L) * 100).toFixed(1)}%"></i>`;
  return `<div class="vz vz-range">
    <div class="vz-track"><i class="vz-sl" style="width:${x0.toFixed(1)}%"></i><i class="vz-tp" style="left:${x0.toFixed(1)}%"></i><i class="vz-zero" style="left:${x0.toFixed(1)}%"><em>${entryLabel}</em></i>${dot}</div>
    <div class="vz-rl"><span class="down">${slLabel}</span><span class="up">${tpLabel}</span></div>
  </div>`;
}

// Leyenda de estados: [{ dot: 'up' | 'amber' | 'blue' | 'down', label, sub? }]
export function vLegend(items) {
  return `<div class="vz vz-legend">${items.map((it) => `<span class="vz-lg"><i class="vz-ld ${it.dot}"></i><span><b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}</span></span>`).join('')}</div>`;
}

// Medidor: value/max con etiquetas a cada lado.
export function vMeter({ pct, left, right, t = 'amber' }) {
  return `<div class="vz vz-meter"><div class="vz-mtrack"><i class="${t}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div><div class="vz-ml"><span>${left}</span><span>${right}</span></div></div>`;
}

// Barra apilada: en qué se reparte una cantidad. parts: [{ v: número, label, sub, t }]
export function vStack(parts) {
  const tot = parts.reduce((a, p) => a + Math.max(0, p.v), 0) || 1;
  return `<div class="vz vz-stack"><div class="vz-sbar">${parts.map((p) => `<i class="${p.t || ''}" style="flex-grow:${Math.max(0, p.v) / tot}"></i>`).join('')}</div>
    <div class="vz-slg">${parts.map((p) => `<span class="vz-lg"><i class="vz-ld ${p.t || ''}"></i><span><b>${p.label}</b>${p.sub ? `<small>${p.sub}</small>` : ''}</span></span>`).join('')}</div></div>`;
}
