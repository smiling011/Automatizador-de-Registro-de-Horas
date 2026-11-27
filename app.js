/*LOGIC_START*/
const pad = n => String(n).padStart(2, '0');
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DEFAULTS = {
  consultor: 'victoria.vielma@gruponetw.com',
  negocioCodigo: 'NTSA', negocioSin: 'NETW',
  funcionalSin: 'Camilo Garcia Analista PMO', proyectoSin: 'Servicio al cliente', tipoSin: 'Sin número de gestión',
  estado: 'Finalizado', causa: 'Integraciones', escalo: 'NO', casuistica: 'Configuración', criticidad: 'Baja',
  camHoras: 4, pmoLJ: 4.5, pmoV: 4, inicio: 7.5, finLJ: 17, finV: 16.5, quitarNumeral: true, enterasConDecimal: false,
  tipos: {
    IN: { tipo: 'Incidente', proyecto: 'Field Service', camaleom: true },
    SR: { tipo: 'Solicitud de servicio', proyecto: 'Servicio al cliente', camaleom: true }
  }
};
function toMin(h, mi, ap) {
  h = +h; mi = +mi;
  if (ap) { ap = ap[0].toLowerCase(); if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; }
  return h * 60 + mi;
}
function fmtTime(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return pad(h12) + ':' + pad(m) + (h >= 12 ? 'pm' : 'am');
}
function dateKey(d) { const [dd, mm, yy] = d.split('/'); return yy + mm + dd; }
function weekday(d) { const [dd, mm, yy] = d.split('/').map(Number); return new Date(yy, mm - 1, dd).getDay(); }
function fmtNum(h) {
  const half = Math.abs(h * 2 - Math.round(h * 2)) < 1e-9;
  return (half ? h.toFixed(1) : h.toFixed(2)).replace('.', ',');
}
function findCode(desc) {
  const m = /#?\b([A-Za-z]{2,4})(\d{5,})\b/.exec(desc);
  return m ? { prefix: m[1].toUpperCase(), code: m[1].toUpperCase() + m[2] } : null;
}
function parseLog(text) {
  const entries = [], errors = [];
  let date = null;
  const dre = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
  const ere = /^\s*(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?\s*[-–—]\s*(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?\s*\|\s*(.+?)\s*$/i;
  text.split(/\r?\n/).forEach((ln, i) => {
    const t = ln.trim();
    if (!t || /^-{3,}$/.test(t)) return;
    let m = ln.match(dre);
    if (m) { date = pad(m[1]) + '/' + pad(m[2]) + '/' + m[3]; return; }
    m = ln.match(ere);
    if (!m) { errors.push({ line: i + 1, text: t, msg: 'No reconozco el formato' }); return; }
    if (!date) { errors.push({ line: i + 1, text: t, msg: 'Falta la fecha encima' }); return; }
    const a1 = m[3], a2 = m[6];
    const s = toMin(m[1], m[2], a1 || a2), e = toMin(m[4], m[5], a2 || a1);
    if (e <= s) { errors.push({ line: i + 1, text: t, msg: 'La hora final no es mayor que la inicial' }); return; }
    entries.push({ date, start: s, end: e, dur: (e - s) / 60, desc: m[7].replace(/\s+/g, ' '), id: date + '|' + s });
  });
  return { entries, errors };
}
function enrich(entries, cfg) {
  entries.forEach(e => {
    e.code = null; e.type = null; e.prefix = null; e.unknownPrefix = null;
    const f = findCode(e.desc);
    if (!f) return;
    const type = cfg.tipos[f.prefix];
    if (type) { e.code = f.code; e.type = type; e.prefix = f.prefix; } else e.unknownPrefix = f.prefix;
  });
  return entries;
}
function allocate(w, units, min) {
  const n = w.length; if (!n) return [];
  if (n * min > units) return null;
  const W = w.reduce((a, b) => a + b, 0) || n;
  const ideal = w.map(x => units * (W === n && !w.some(Boolean) ? 1 : x) / W);
  let a = ideal.map(x => Math.max(min, Math.floor(x + 1e-9)));
  let sum = a.reduce((x, y) => x + y, 0);
  while (sum > units) {
    let k = -1, best = -Infinity;
    a.forEach((v, i) => { if (v > min && v - ideal[i] > best) { best = v - ideal[i]; k = i; } });
    if (k < 0) break; a[k]--; sum--;
  }
  while (sum < units) {
    let k = 0, best = -Infinity;
    a.forEach((v, i) => { if (ideal[i] - v > best) { best = ideal[i] - v; k = i; } });
    a[k]++; sum++;
  }
  return a;
}
function camGroups(day) {
  const map = new Map();
  day.forEach(e => { if (e.code && e.type && e.type.camaleom) map.set(e.code, (map.get(e.code) || 0) + e.dur); });
  return [...map].map(([code, h]) => ({ code, h }));
}
function camAlloc(groups, cfg, ov) {
  const units = Math.round(cfg.camHoras * 2);
  let g = groups.slice(), over = false;
  if (g.length > units) {
    const keep = new Set(g.slice().sort((a, b) => b.h - a.h).slice(0, units).map(x => x.code));
    g = g.filter(x => keep.has(x.code)); over = true;
  }
  if (!g.length) return { rows: [], over, total: 0, units };
  let u;
  if (ov && g.every(x => ov[x.code] != null)) u = g.map(x => ov[x.code]);
  else if (g.length <= cfg.camHoras) u = allocate(g.map(x => x.h), Math.round(cfg.camHoras), 1).map(x => x * 2);
  else u = allocate(g.map(x => x.h), units, 1);
  return { rows: g.map((x, i) => ({ code: x.code, units: u[i], worked: x.h })), over, total: u.reduce((a, b) => a + b, 0), units };
}
function fmtCam(units, cfg) {
  const v = units / 2;
  if (Number.isInteger(v)) return cfg.enterasConDecimal ? v + ',0' : String(v);
  return Math.floor(v) + ',5';
}
function camLine(r, cfg) { return '(' + fmtCam(r.units, cfg) + ' Horas - ' + r.code + ' )'; }
function pmoTarget(date, cfg) { return weekday(date) === 5 ? cfg.pmoV : cfg.pmoLJ; }
function jornada(date, cfg) {
  return { ini: Math.round(cfg.inicio * 60), fin: Math.round((weekday(date) === 5 ? cfg.finV : cfg.finLJ) * 60) };
}
/* huecos libres de la jornada, descontando lo que va a Camaleom */
function huecosLibres(day, j) {
  const occ = day.filter(e => e.code && e.type && e.type.camaleom)
    .map(e => [Math.max(e.start, j.ini), Math.min(e.end, j.fin)]).filter(x => x[1] > x[0]).sort((p, q) => p[0] - q[0]);
  const gaps = []; let cur = j.ini;
  occ.forEach(([s, e]) => { if (s > cur) gaps.push([cur, s]); cur = Math.max(cur, e); });
  if (cur < j.fin) gaps.push([cur, j.fin]);
  return gaps;
}
/* coloca bloques (en minutos) dentro de la jornada, sin pasarse del límite */
function colocar(durs, pref, gaps, j) {
  const tryPlace = (from) => {
    const out = []; let cur = from;
    for (const d of durs) {
      let ok = false;
      for (const [gs, ge] of gaps) {
        const s = Math.max(gs, cur);
        if (s + d <= ge) { out.push(s); cur = s + d; ok = true; break; }
      }
      if (!ok) return null;
    }
    return out;
  };
  let r = tryPlace(Math.max(j.ini, pref)) || tryPlace(j.ini);
  if (r) return { starts: r, overlap: false };
  const out = []; let cur = j.ini;               // último recurso: ignora Camaleom, nunca la jornada
  durs.forEach(d => { out.push(cur); cur += d; });
  return { starts: out, overlap: true };
}
function buildPMO(day, cfg) {
  const date = day[0].date, target = pmoTarget(date, cfg), tunits = Math.round(target * 2);
  const j = jornada(date, cfg);
  let items = day.filter(e => !(e.code && e.type && e.type.camaleom));
  const res = { date, target, real: 0, items: [], adjusted: false, moved: false, overlap: false, trimmed: false, j };
  if (!items.length) return res;
  res.real = items.reduce((a, e) => a + e.dur, 0);
  if (items.length > tunits) {
    const keep = new Set(items.slice().sort((a, b) => b.dur - a.dur).slice(0, tunits).map(e => e.id));
    items = items.filter(e => keep.has(e.id)); res.trimmed = true;
  }
  const a = allocate(items.map(e => e.dur), tunits, 1);
  const same = items.every((e, i) => Math.abs(a[i] / 2 - e.dur) < 1e-9);
  const dentro = items.every(e => e.start >= j.ini && e.end <= j.fin);
  if (same && dentro) {
    res.items = items.map(e => ({ date, start: e.start, end: e.end, desc: e.desc, dur: e.dur }));
  } else {
    res.adjusted = !same; res.moved = same && !dentro;
    const durs = a.map(u => u * 30);
    const p = colocar(durs, items[0].start, huecosLibres(day, j), j);
    res.overlap = p.overlap;
    res.items = items.map((e, i) => ({ date, start: p.starts[i], end: p.starts[i] + durs[i], desc: e.desc, dur: a[i] / 2 }));
  }
  return res;
}
function pmoText(it) { return it.date + '\n' + fmtTime(it.start) + ' - ' + fmtTime(it.end) + ' | ' + it.desc; }
function guessLabel(desc) {
  const d = desc.toLowerCase();
  if (/reuni|daily|meeting|seguimiento|sync/.test(d)) return 'Reunión';
  if (/capacit/.test(d)) return 'Capacitación';
  if (/espacio/.test(d)) return 'Espacio';
  return 'Estudio';
}
const COLS = ['Fecha','Negocios','Tiempo','Consultor','Proyecto','Funcional','Tipo de requerimiento','Número de Gestión','Estado','Fecha Creación','Fecha Maxima Solución','Actividad','Causa raiz','Se escalo?','Casuística','Criticidad'];
function buildSheet(entries, cfg, cases, labels) {
  const sorted = entries.slice().sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || a.start - b.start);
  return sorted.map(e => {
    const common = [cfg.estado];
    let r;
    const act = cfg.quitarNumeral ? e.desc.replace(/#(?=[A-Za-z]{2,4}\d{5,})/g, '') : e.desc;
    if (e.code) {
      const c = cases[e.code] || {};
      r = [e.date, cfg.negocioCodigo, fmtNum(e.dur), cfg.consultor, e.type.proyecto, c.funcional || '', e.type.tipo, e.code, cfg.estado, c.creacion || '', c.maxima || '', act, cfg.causa, cfg.escalo, cfg.casuistica, cfg.criticidad];
    } else {
      const lab = (labels && labels[e.id]) || guessLabel(e.desc);
      r = [e.date, cfg.negocioSin, fmtNum(e.dur), cfg.consultor, cfg.proyectoSin, cfg.funcionalSin, cfg.tipoSin, lab, cfg.estado, 'No aplica', 'No aplica', act, cfg.causa, cfg.escalo, cfg.casuistica, cfg.criticidad];
    }
    return { row: r, e };
  });
}
/*LOGIC_END*/

/* ---------- almacenamiento ---------- */
const mem = {};
function load(k, d) { try { const v = localStorage.getItem('rh_' + k); if (v != null) return JSON.parse(v); } catch (e) {} return mem[k] !== undefined ? mem[k] : d; }
function save(k, v) { mem[k] = v; try { localStorage.setItem('rh_' + k, JSON.stringify(v)); } catch (e) {} }
function loadCfg() {
  const s = load('cfg', {});
  const c = Object.assign({}, DEFAULTS, s);
  c.tipos = Object.assign({}, DEFAULTS.tipos, s.tipos || {});
  return c;
}
const S = { cfg: loadCfg(), cases: load('cases', {}), entries: [], errors: [], labels: {}, camOv: {}, copy: [] };
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- copiar ---------- */
async function copyText(t, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch (e) {
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (e2) {}
  }
  const old = btn.dataset.l || btn.textContent; btn.dataset.l = old;
  btn.textContent = ok ? 'Copiado' : 'No se pudo copiar';
  setTimeout(() => { btn.textContent = old; }, 1400);
}
function cp(text) { S.copy.push(text); return 'data-cp="' + (S.copy.length - 1) + '"'; }

/* ---------- paso 2: casos ---------- */
function renderCases() {
  const el = $('s2');
  if (!S.entries.length && !S.errors.length) { el.innerHTML = ''; return; }
  let h = '';
  if (S.errors.length) {
    h += '<div class="banner b"><b>' + S.errors.length + ' línea(s) sin reconocer</b> (no se incluyen):<br>' +
      S.errors.map(e => 'Línea ' + e.line + ': ' + esc(e.text.slice(0, 80)) + ' — ' + e.msg).join('<br>') + '</div>';
  }
  const unk = [...new Set(S.entries.filter(e => e.unknownPrefix).map(e => e.unknownPrefix))];
  if (unk.length) {
    h += '<div class="card"><h2>Código nuevo detectado <small>regístralo para que el sistema lo reconozca</small></h2>';
    unk.forEach(p => {
      const ex = S.entries.find(e => e.unknownPrefix === p);
      h += '<div class="banner" style="display:grid;grid-template-columns:70px 1fr 1fr auto auto;gap:8px;align-items:center">' +
        '<b>' + p + '</b><input type="text" placeholder="Tipo de requerimiento" data-ut="' + p + '"><input type="text" placeholder="Proyecto" data-up="' + p + '">' +
        '<label class="ck"><input type="checkbox" data-uc="' + p + '" checked> Va a Camaleom</label><button class="pri" data-reg="' + p + '">Registrar</button>' +
        '<span class="note" style="grid-column:1/-1">Ejemplo en tu bitácora: ' + esc(ex.desc.slice(0, 90)) + '. Mientras no lo registres se trata como actividad sin código.</span></div>';
    });
    h += '</div>';
  }
  const codes = [];
  S.entries.forEach(e => { if (e.code && !codes.find(c => c.code === e.code)) codes.push(e); });
  if (codes.length) {
    h += '<div class="card"><h2>2. Datos de los casos <small>la persona que creó el caso y sus fechas; se recuerdan para la próxima vez</small></h2><div style="overflow-x:auto"><table><tr><th style="width:110px">Caso</th><th>Funcional (quien creó el caso)</th><th style="width:140px">Fecha creación</th><th style="width:150px">Fecha máx. solución</th></tr>';
    codes.forEach(e => {
      const c = S.cases[e.code] || {};
      const inp = (f, ph) => '<input type="text" data-case="' + e.code + '" data-f="' + f + '" value="' + esc(c[f] || '') + '" placeholder="' + ph + '"' + (c[f] ? '' : ' class="miss"') + '>';
      h += '<tr><td class="mono">' + e.code + '</td><td>' + inp('funcional', 'Nombre completo') + '</td><td>' + inp('creacion', 'dd/mm/aaaa') + '</td><td>' + inp('maxima', 'dd/mm/aaaa') + '</td></tr>';
    });
    h += '</table></div></div>';
  }
  const sin = S.entries.filter(e => !e.code);
  if (sin.length) {
    h += '<div class="card"><h2>Actividades sin código <small>etiqueta que va en “Número de Gestión” de la hoja (ajústala si hace falta)</small></h2><div style="overflow-x:auto"><table>';
    sin.forEach(e => {
      const cur = S.labels[e.id] || guessLabel(e.desc);
      const opts = ['Estudio', 'Reunión', 'Capacitación', 'Espacio'].map(o => '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('');
      h += '<tr><td style="width:100px" class="note">' + e.date + '</td><td style="width:150px" class="mono">' + fmtTime(e.start) + ' - ' + fmtTime(e.end) + '</td><td>' + esc(e.desc.slice(0, 90)) + '</td><td style="width:140px"><select data-lab="' + e.id + '">' + opts + '</select></td></tr>';
    });
    h += '</table></div></div>';
  }
  el.innerHTML = h;
}

/* ---------- paso 3: salidas ---------- */
function renderOutputs() {
  S.copy = [];
  const el = $('s3');
  if (!S.entries.length) { el.innerHTML = ''; return; }
  const cfg = S.cfg;
  const days = {};
  S.entries.forEach(e => (days[e.date] = days[e.date] || []).push(e));
  const dkeys = Object.keys(days).sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  let h = '';
  const unk = S.entries.filter(e => e.unknownPrefix).length;
  if (unk) h += '<div class="banner">Hay ' + unk + ' actividad(es) con un código sin registrar; se tratan como actividad sin código.</div>';
  let missing = 0;
  S.entries.forEach(e => { if (e.code) { const c = S.cases[e.code] || {}; ['funcional', 'creacion', 'maxima'].forEach(f => { if (!c[f]) missing++; }); } });
  if (missing) h += '<div class="banner">Faltan ' + missing + ' dato(s) de casos (celdas resaltadas arriba). La hoja saldrá con esas celdas vacías.</div>';

  dkeys.forEach(d => {
    const day = days[d].slice().sort((a, b) => a.start - b.start);
    const total = day.reduce((a, e) => a + e.dur, 0);
    const cam = camAlloc(camGroups(day), cfg, S.camOv[d]);
    const pmo = buildPMO(day, cfg);
    h += '<div class="card"><div class="dayhead"><b>' + d + '</b><span class="note">' + DIAS[weekday(d)] + ' · ' + fmtNum(total) + ' h en la bitácora</span></div><div class="grid2">';
    // Camaleom
    const okc = cam.total === cam.units;
    h += '<div class="box"><h3><span>Camaleom <span class="chip' + (okc ? '' : ' b') + '">' + fmtCam(cam.total, cfg) + ' de ' + cfg.camHoras + ' h</span></span>' +
      (cam.rows.length ? '<button class="sm" ' + cp(cam.rows.map(r => camLine(r, cfg)).join('\n')) + '>Copiar</button>' : '') + '</h3>';
    if (!cam.rows.length) h += '<div class="note">Sin casos IN/SR este día.</div>';
    cam.rows.forEach(r => {
      h += '<div class="camrow"><span class="mono">' + esc(camLine(r, cfg)) + '</span><button class="sm" data-adj="-1" data-day="' + d + '" data-code="' + r.code + '" aria-label="Quitar media hora">−</button><button class="sm" data-adj="1" data-day="' + d + '" data-code="' + r.code + '" aria-label="Sumar media hora">+</button></div>';
    });
    if (cam.over) h += '<div class="note" style="color:var(--warn)">Hay más casos que bloques de 0,5 h; se muestran los de mayor tiempo.</div>';
    if (cam.rows.length) h += '<div class="note" style="margin-top:6px">Los botones − y + mueven 0,5 h; el total debe quedar en ' + cfg.camHoras + ' h.</div>';
    h += '</div>';
    // PMO
    h += '<div class="box"><h3><span>PMO <span class="chip' + (pmo.items.length ? '' : ' w') + '">' + fmtNum(pmo.items.reduce((a, i) => a + i.dur, 0)) + ' de ' + fmtNum(pmo.target) + ' h</span></span>' +
      (pmo.items.length ? '<button class="sm" ' + cp(pmo.items.map(pmoText).join('\n\n')) + '>Copiar todo</button>' : '') + '</h3>';
    if (!pmo.items.length) h += '<div class="note">Sin actividades sin código este día (reuniones, espacios, capacitación, estudio).</div>';
    pmo.items.forEach(it => {
      h += '<div class="pmoitem"><span class="mono">' + esc(pmoText(it)) + '</span><button class="sm" ' + cp(pmoText(it)) + '>Copiar</button></div>';
    });
    if (pmo.adjusted) h += '<div class="note" style="margin-top:6px">Tiempo real sin código: ' + fmtNum(pmo.real) + ' h. Se ajustó a ' + fmtNum(pmo.target) + ' h repartiendo el horario dentro de la jornada (' + fmtTime(pmo.j.ini) + ' a ' + fmtTime(pmo.j.fin) + ').</div>';
    if (pmo.moved) h += '<div class="note" style="margin-top:6px">Se movió al horario laboral (' + fmtTime(pmo.j.ini) + ' a ' + fmtTime(pmo.j.fin) + ').</div>';
    if (pmo.overlap) h += '<div class="note" style="color:var(--warn)">No había un hueco libre; el horario se cruza con casos de Camaleom.</div>';
    if (pmo.trimmed) h += '<div class="note" style="color:var(--warn)">Hay más actividades que bloques de 0,5 h; se muestran las más largas.</div>';
    h += '</div></div></div>';
  });

  // Hoja
  const rows = buildSheet(S.entries, cfg, S.cases, S.labels);
  const colTexts = COLS.map((_, ci) => rows.map(r => r.row[ci]).join('\n'));
  h += '<div class="card"><h2>Hoja de cálculo <small>cada columna se copia por separado y se pega hacia abajo</small><span class="chip">' + rows.length + ' fila(s)</span>' +
    '<button class="sm" style="margin-left:auto" ' + cp(rows.map(r => r.row.join('\t')).join('\n')) + '>Copiar todas las filas</button></h2>';
  h += '<div class="sheetwrap"><table><tr>' + COLS.map((c, i) => '<th>' + c + '<br><button class="sm" ' + cp(colTexts[i]) + '>Copiar columna</button></th>').join('') + '</tr>';
  rows.forEach(r => {
    h += '<tr>' + r.row.map((v, i) => '<td' + (i === 2 ? ' class="c"' : '') + (v === '' ? ' class="empty"' : '') + ' title="' + esc(v) + '">' + esc(v) + '</td>').join('') + '</tr>';
  });
  h += '</table></div></div>';
  el.innerHTML = h;
}

/* ---------- ajustes ---------- */
function renderSettings() {
  const c = S.cfg;
  const f = (k, l, num) => '<div><label>' + l + '</label><input type="text" data-cfg="' + k + '"' + (num ? ' data-num="1"' : '') + ' value="' + esc(c[k]) + '"></div>';
  let h = '<div class="set">' +
    f('consultor', 'Consultor (correo)') + f('negocioCodigo', 'Negocio con código') + f('negocioSin', 'Negocio sin código') +
    f('funcionalSin', 'Funcional sin código') + f('proyectoSin', 'Proyecto sin código') + f('tipoSin', 'Tipo sin código') +
    f('estado', 'Estado') + f('causa', 'Causa raíz') + f('escalo', '¿Se escaló?') + f('casuistica', 'Casuística') + f('criticidad', 'Criticidad') +
    f('camHoras', 'Horas Camaleom por día', 1) + f('pmoLJ', 'Horas PMO lunes a jueves', 1) + f('pmoV', 'Horas PMO viernes', 1) +
    f('inicio', 'Inicio de jornada (7,5 = 7:30 am)', 1) + f('finLJ', 'Fin lunes a jueves (17 = 5:00 pm)', 1) + f('finV', 'Fin viernes (16,5 = 4:30 pm)', 1) + '</div>' +
    '<div class="row"><label class="ck"><input type="checkbox" data-cfgck="quitarNumeral"' + (c.quitarNumeral ? ' checked' : '') + '> Quitar el # de los códigos en la hoja</label>' +
    '<label class="ck"><input type="checkbox" data-cfgck="enterasConDecimal"' + (c.enterasConDecimal ? ' checked' : '') + '> Camaleom: horas enteras como 1,0</label></div>' +
    '<h2 style="margin-top:16px;font-size:14px">Tipos de código</h2><table><tr><th style="width:70px">Prefijo</th><th>Tipo de requerimiento</th><th>Proyecto</th><th style="width:110px">Va a Camaleom</th><th style="width:40px"></th></tr>';
  Object.keys(c.tipos).forEach(p => {
    const t = c.tipos[p];
    h += '<tr><td class="mono">' + p + '</td><td><input type="text" data-tp="' + p + '" data-tf="tipo" value="' + esc(t.tipo) + '"></td><td><input type="text" data-tp="' + p + '" data-tf="proyecto" value="' + esc(t.proyecto) + '"></td>' +
      '<td><label class="ck"><input type="checkbox" data-tpc="' + p + '"' + (t.camaleom ? ' checked' : '') + '> Sí</label></td><td><button class="sm" data-tdel="' + p + '" aria-label="Quitar tipo">×</button></td></tr>';
  });
  h += '</table><div class="row"><input type="text" id="newP" placeholder="Prefijo (ej. CH)" style="width:130px"><input type="text" id="newT" placeholder="Tipo de requerimiento" style="width:220px"><input type="text" id="newPr" placeholder="Proyecto" style="width:200px"><button id="addT">Agregar tipo</button></div>';
  $('setBody').innerHTML = h;
}
function saveCfg() { save('cfg', S.cfg); }

/* ---------- proceso ---------- */
function process() {
  const text = $('log').value;
  save('log', text);
  const r = parseLog(text);
  S.entries = enrich(r.entries, S.cfg); S.errors = r.errors; S.camOv = {};
  $('procMsg').textContent = S.entries.length ? S.entries.length + ' actividad(es) en ' + new Set(S.entries.map(e => e.date)).size + ' día(s)' : (text.trim() ? 'No encontré actividades' : '');
  renderCases(); renderOutputs();
}
const EJ = `20/11/2026
07:30am - 08:30am | Resolución del incidente de ayer #IN514759  Validando con Brandon y con Edilberto

20/11/2026
08:30am - 10:00am | Resolución del incidente  #IN514814 en un Espacio con Edi se validó y se dió introducción a SAP.

20/11/2026
10:00am - 11:30am | Resolución del #SR5120842 valido con Daniel sobre los datos del usuario afectado

20/11/2026
11:30am - 12:00pm | Visualización de los videos Refuerzo novedades MIGO FS 1 y 2 | Aclaración de dudas con Edilberto y brandon

20/11/2026
12:00pm - 01:00pm | Resolución del incidente #IN514849 error de integración

20/11/2026
02:00pm - 03:00pm | Solución del incidente #IN514849 error de integración

20/11/2026
03:00pm - 04:30pm | Resolución de incidente #IN514956 MOVILIZACIONES DE ENTREGA NO APARECE LA FOTO DE LA IDENTIFICACION DEL CLIENTE`;

/* ---------- eventos ---------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('button'); if (!t) return;
  if (t.dataset.cp != null) { copyText(S.copy[+t.dataset.cp], t); return; }
  if (t.dataset.adj) {
    const d = t.dataset.day, code = t.dataset.code, step = +t.dataset.adj;
    const day = S.entries.filter(e => e.date === d);
    const cur = camAlloc(camGroups(day), S.cfg, S.camOv[d]);
    const ov = {}; cur.rows.forEach(r => ov[r.code] = r.units);
    ov[code] = Math.max(1, ov[code] + step);
    S.camOv[d] = ov; renderOutputs(); return;
  }
  if (t.dataset.reg) {
    const p = t.dataset.reg;
    const tipo = document.querySelector('[data-ut="' + p + '"]').value.trim();
    const proy = document.querySelector('[data-up="' + p + '"]').value.trim();
    const cam = document.querySelector('[data-uc="' + p + '"]').checked;
    if (!tipo || !proy) { t.textContent = 'Completa tipo y proyecto'; setTimeout(() => t.textContent = 'Registrar', 1500); return; }
    S.cfg.tipos[p] = { tipo, proyecto: proy, camaleom: cam }; saveCfg(); renderSettings(); process(); return;
  }
  if (t.dataset.tdel) { delete S.cfg.tipos[t.dataset.tdel]; saveCfg(); renderSettings(); process(); return; }
  if (t.id === 'addT') {
    const p = $('newP').value.trim().toUpperCase(), tp = $('newT').value.trim(), pr = $('newPr').value.trim();
    if (!/^[A-Z]{2,4}$/.test(p) || !tp || !pr) { t.textContent = 'Prefijo de 2 a 4 letras, tipo y proyecto'; setTimeout(() => t.textContent = 'Agregar tipo', 1800); return; }
    S.cfg.tipos[p] = { tipo: tp, proyecto: pr, camaleom: true }; saveCfg(); renderSettings(); process(); return;
  }
  if (t.id === 'btnProc') process();
  if (t.id === 'btnEj') { $('log').value = EJ; process(); }
  if (t.id === 'btnClr') { $('log').value = ''; process(); }
});
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.case) {
    const c = S.cases[t.dataset.case] = S.cases[t.dataset.case] || {};
    c[t.dataset.f] = t.value.trim(); save('cases', S.cases);
    t.classList.toggle('miss', !t.value.trim()); renderOutputs(); return;
  }
  if (t.dataset.cfg) {
    const k = t.dataset.cfg; let v = t.value;
    if (t.dataset.num) { v = parseFloat(v.replace(',', '.')); if (!(v > 0)) return; }
    S.cfg[k] = v; saveCfg(); renderOutputs(); return;
  }
  if (t.dataset.tp) { S.cfg.tipos[t.dataset.tp][t.dataset.tf] = t.value; saveCfg(); renderOutputs(); return; }
  if (t.id === 'log') { clearTimeout(window._d); window._d = setTimeout(process, 500); }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.lab) { S.labels[t.dataset.lab] = t.value; renderOutputs(); return; }
  if (t.dataset.cfgck) { S.cfg[t.dataset.cfgck] = t.checked; saveCfg(); renderOutputs(); return; }
  if (t.dataset.tpc) { S.cfg.tipos[t.dataset.tpc].camaleom = t.checked; saveCfg(); process(); }
});

$('log').value = load('log', '');
renderSettings();
process();

/* =====================================================
   DECORACIONES BARBIE (solo adorno, no tocan la lógica)
   ===================================================== */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layer = document.getElementById('deco');
  if (!layer || reduce) return;
  const SIMB = ['💖', '✨', '🎀', '💗', '⭐', '💕', '🌸'];
  const COLORES = ['#ff4fa3', '#ff9ccf', '#ffd1e8', '#e0218a', '#fff'];

  /* corazones y brillos que flotan de fondo */
  function flotante() {
    const s = document.createElement('span');
    s.className = 'float';
    s.textContent = SIMB[Math.floor(Math.random() * SIMB.length)];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.fontSize = 14 + Math.random() * 22 + 'px';
    s.style.animationDuration = 9 + Math.random() * 9 + 's';
    s.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    layer.appendChild(s);
    setTimeout(() => s.remove(), 19000);
  }
  for (let i = 0; i < 8; i++) setTimeout(flotante, i * 500);
  setInterval(flotante, 1600);

  /* estela de brillos que sigue al cursor */
  let ultimo = 0;
  document.addEventListener('pointermove', e => {
    const t = performance.now();
    if (t - ultimo < 55) return;
    ultimo = t;
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = Math.random() < .5 ? '✦' : '✧';
    s.style.left = e.clientX + 'px';
    s.style.top = e.clientY + 'px';
    s.style.color = COLORES[Math.floor(Math.random() * COLORES.length)];
    layer.appendChild(s);
    setTimeout(() => s.remove(), 900);
  });

  /* explosión de corazones y confeti */
  function explosion(x, y, n, simbolos) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'burst';
      p.textContent = simbolos[Math.floor(Math.random() * simbolos.length)];
      const ang = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--tx', Math.cos(ang) * d + 'px');
      p.style.setProperty('--ty', Math.sin(ang) * d - 30 + 'px');
      p.style.fontSize = 12 + Math.random() * 14 + 'px';
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b.dataset.cp != null) explosion(e.clientX, e.clientY, 16, ['💖', '✨', '🎀', '💗', '⭐']);
    else if (b && b.id === 'btnProc') explosion(e.clientX, e.clientY, 22, ['💖', '✨', '💕', '🌸']);
    else if (!b) explosion(e.clientX, e.clientY, 5, ['💗', '✨']);
  });

  /* el lazo del título también reacciona */
  const lazo = document.getElementById('lazo');
  if (lazo) lazo.addEventListener('click', e => { e.stopPropagation(); explosion(e.clientX, e.clientY, 30, ['🎀', '💖', '✨', '💗']); });
})();