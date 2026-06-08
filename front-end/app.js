// ⚙️ Cambiá esta URL por la dirección donde esté corriendo el backend
const API = 'https://novedades-operativas.onrender.com';
 
let novedades = [];
let filtradasCache = [];
let paginaActual = 1;
const POR_PAGINA = 20;
let editandoId = null;
let cargando = false;
 
function hoy() {
  return new Date().toISOString().split('T')[0];
}
function formatFecha(f) {
  if (!f) return '—';
  // Neon devuelve fechas como "2026-05-12T00:00:00.000Z" o "2026-05-12"
  const s = f.split('T')[0];
  const p = s.split('-');
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return f;
}
function diasDesde(n) {
  const fechaInicio = n.fecha;
  if (!fechaInicio) return '—';

  const esCerrada = n.estado === 'Solucionado' || n.estado === 'Finalizada';
  const desde = new Date(fechaInicio.split('T')[0]);
  desde.setHours(0,0,0,0);

  if (esCerrada && n.fechaFin) {
    const hasta = new Date(n.fechaFin.split('T')[0]);
    hasta.setHours(0,0,0,0);
    const d = Math.round((hasta - desde) / 86400000);
    return isNaN(d) ? '—' : d;
  }

  const hoyD = new Date(); hoyD.setHours(0,0,0,0);
  const d = Math.round((hoyD - desde) / 86400000);
  return isNaN(d) ? '—' : d;
}
function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
 
// Normalizar campos que vienen de la DB (fecha_fin → fechaFin, etc.)
function normalizarRow(r) {
  return {
    id: r.id,
    fecha: r.fecha,
    aerop: r.aerop,
    area: r.area,
    dependencia: r.dependencia,
    sistema: r.sistema,
    estado: r.estado,
    motivo: r.motivo,
    impacto: r.impacto,
    obs: r.obs,
    notam: r.notam,
    evidencia: r.evidencia,
    criticidad: r.criticidad,
    fechaFin: r.fecha_fin,
    plan: r.plan,
  };
}
 
// ─────────────────────────────────────────────
// LOGGING Y API CALLS — con detección de errores
// ─────────────────────────────────────────────

function logFront(nivel, contexto, mensaje, detalle) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${nivel.toUpperCase()}] [${contexto}]`;
  if (nivel === 'error')      console.error(prefix, mensaje, detalle ?? '');
  else if (nivel === 'warn')  console.warn(prefix, mensaje, detalle ?? '');
  else                        console.log(prefix, mensaje, detalle ?? '');
}

class ApiNetworkError extends Error {
  constructor(url, causa) {
    super(`Sin conexión con el servidor: ${url}`);
    this.name = 'ApiNetworkError'; this.url = url; this.causa = causa;
  }
}
class ApiHttpError extends Error {
  constructor(metodo, url, status, cuerpo) {
    super(`HTTP ${status} en ${metodo} ${url}`);
    this.name = 'ApiHttpError';
    this.metodo = metodo; this.url = url; this.status = status; this.cuerpo = cuerpo;
  }
}
class ApiValidationError extends Error {
  constructor(url, errores) {
    super(`Datos rechazados por el servidor: ${url}`);
    this.name = 'ApiValidationError'; this.url = url; this.errores = errores;
  }
}

async function apiFetch(metodo, path, body) {
  const url = API + path;
  const opts = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);

  logFront('info', `API ${metodo}`, path, body ?? '');

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const error = new ApiNetworkError(url, err.message);
    logFront('error', `API ${metodo}`, '❌ Error de red — servidor inaccesible', {
      url,
      causa: err.message,
      sugerencia: 'Verificá que el backend esté corriendo y que la variable API sea correcta',
    });
    throw error;
  }

  let data;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    if (res.status === 400) {
      const errores = data?.detalle ?? [data?.error ?? 'Error de validación'];
      logFront('warn', `API ${metodo}`, `⚠ Validación rechazada (400) — ${path}`, { errores, enviado: body });
      throw new ApiValidationError(url, errores);
    }
    if (res.status === 409)
      logFront('warn', `API ${metodo}`, `⚠ Conflicto (409) — ID duplicado — ${path}`, { detalle: data?.error });
    if (res.status === 404)
      logFront('warn', `API ${metodo}`, `⚠ Recurso no encontrado (404) — ${path}`, { detalle: data?.error });
    if (res.status >= 500)
      logFront('error', `API ${metodo}`, `❌ Error interno del servidor (${res.status}) — ${path}`, { detalle: data?.detalle ?? data?.error });

    throw new ApiHttpError(metodo, url, res.status, data);
  }

  logFront('info', `API ${metodo}`, `✔ ${res.status} — ${path}`);
  return data;
}

async function apiGet(path)        { return apiFetch('GET',    path); }
async function apiPost(path, body) { return apiFetch('POST',   path, body); }
async function apiPut(path, body)  { return apiFetch('PUT',    path, body); }
async function apiDelete(path)     { return apiFetch('DELETE', path); }
 
async function cargarNovedades() {
  mostrarCargando(true);
  try {
    const rows = await apiGet('/novedades');
    novedades = rows.map(normalizarRow);
  } catch(e) {
    mostrarBannerError('No se pudo conectar con el servidor. Verificá que el backend esté corriendo.');
  } finally {
    mostrarCargando(false);
  }
}
 
function mostrarCargando(v) {
  cargando = v;
  const tb = document.getElementById('tabla-body');
  if (v) tb.innerHTML = `<tr><td colspan="12" class="sin-datos">⏳ Cargando datos...</td></tr>`;
}
 
function mostrarBannerError(msg) {
  const b = document.getElementById('banner-error');
  b.textContent = '⚠ ' + msg;
  b.classList.remove('oculto');
  setTimeout(()=>b.classList.add('oculto'), 6000);
}
 
// === RESUMEN CARDS ===
function renderCards(datos, contenedorId) {
  const total = datos.length;
  const abiertas = datos.filter(n => n.estado === 'Abierta').length;
  const curso = datos.filter(n => n.estado === 'En Curso').length;
  const sol = datos.filter(n => n.estado === 'Solucionado').length;
  const crit = datos.filter(n => n.criticidad === 'Alta').length;
  document.getElementById(contenedorId).innerHTML = `
    <div class="card-stat total"><div class="label">Total</div><div class="valor">${total}</div></div>
    <div class="card-stat abiertas"><div class="label">Abiertas</div><div class="valor">${abiertas}</div></div>
    <div class="card-stat curso"><div class="label">En Curso</div><div class="valor">${curso}</div></div>
    <div class="card-stat solucionadas"><div class="label">Solucionadas</div><div class="valor">${sol}</div></div>
    <div class="card-stat criticas"><div class="label">Críticas</div><div class="valor">${crit}</div></div>
  `;
}
 
// === FILTROS ===
function poblarFiltros() {
  const aerops = [...new Set(novedades.map(n => n.aerop).filter(Boolean))].sort();
  const areas = [...new Set(novedades.map(n => n.area).filter(Boolean))].sort();
  const sA = document.getElementById('filtro-aerop');
  const sAr = document.getElementById('filtro-area');
  const prevA = sA.value; const prevAr = sAr.value;
  sA.innerHTML = '<option value="">Todos los aeropuertos</option>' + aerops.map(a=>`<option>${a}</option>`).join('');
  sAr.innerHTML = '<option value="">Todas las áreas</option>' + areas.map(a=>`<option>${a}</option>`).join('');
  sA.value = prevA; sAr.value = prevAr;
}
function aplicarFiltros(filtroQueCambio) {
  const esFecha = filtroQueCambio === 'filtro-fecha-desde' || filtroQueCambio === 'filtro-fecha-hasta';
  if (!esFecha) {
    if (filtroQueCambio !== 'filtro-texto') document.getElementById('filtro-texto').value = '';
    if (filtroQueCambio !== 'filtro-aerop') document.getElementById('filtro-aerop').value = '';
    if (filtroQueCambio !== 'filtro-area') document.getElementById('filtro-area').value = '';
    if (filtroQueCambio !== 'filtro-estado') document.getElementById('filtro-estado').value = '';
    if (filtroQueCambio !== 'filtro-criticidad') document.getElementById('filtro-criticidad').value = '';
    document.getElementById('filtro-fecha-desde').value = '';
    document.getElementById('filtro-fecha-hasta').value = '';
  }
  const txt = document.getElementById('filtro-texto').value.toLowerCase();
  const aerop = document.getElementById('filtro-aerop').value;
  const area = document.getElementById('filtro-area').value;
  const estadoFiltro = document.getElementById('filtro-estado').value;
  const crit = document.getElementById('filtro-criticidad').value;
  const desde = document.getElementById('filtro-fecha-desde').value;
  const hasta = document.getElementById('filtro-fecha-hasta').value;

  filtradasCache = novedades.filter(n => {
    if (aerop && n.aerop !== aerop) return false;
    if (area && n.area !== area) return false;
    if (crit && n.criticidad !== crit) return false;
    if (estadoFiltro && n.estado !== estadoFiltro) return false;
    if (txt) {
      const hay = [n.sistema,n.motivo,n.obs,n.plan].join(' ').toLowerCase();
      if (!hay.includes(txt)) return false;
    }
    const fechaNov = n.fecha ? n.fecha.split('T')[0] : '';
    if (desde && fechaNov < desde) return false;
    if (hasta && fechaNov > hasta) return false;
    return true;
  });
  paginaActual = 1;
  renderTabla();
  renderCards(filtradasCache, 'cards-resumen');
}
function limpiarFiltros() {
  document.getElementById('filtro-texto').value='';
  document.getElementById('filtro-aerop').value='';
  document.getElementById('filtro-area').value='';
  document.getElementById('filtro-estado').value='';
  document.getElementById('filtro-criticidad').value='';
  document.getElementById('filtro-fecha-desde').value='';
  document.getElementById('filtro-fecha-hasta').value='';
  aplicarFiltros('limpiar');
}
 
function badgeEstado(n) {
  const m = {
    'Abierta':     'badge-abierta',
    'En Curso':    'badge-curso',
    'Solucionado': 'badge-solucionado',
    'Finalizada':  'badge-finalizada',
  };
  return `<span class="badge ${m[n.estado] || ''}">${n.estado || '—'}</span>`;
}
function badgeCrit(c) {
  const m = {'Alta':'badge-alta','Media':'badge-media','Baja':'badge-baja'};
  return `<span class="badge ${m[c]||''}">${c||'—'}</span>`;
}
function badgeImpacto(i) {
  if (!i) return '—';
  if (i==='Afecta ATS') return `<span class="badge badge-afecta">Afecta ATS</span>`;
  if (i==='Afectacion Parcial') return `<span class="badge badge-parcial">Parcial</span>`;
  return `<span class="badge badge-noafecta">NO Afecta</span>`;
}
 
// === TABLA ===
function renderTabla() {
  const total = filtradasCache.length;
  const inicio = (paginaActual-1)*POR_PAGINA;
  const fin = inicio + POR_PAGINA;
  const pagina = filtradasCache.slice(inicio, fin);
  const tbody = document.getElementById('tabla-body');
  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="sin-datos">No hay novedades que coincidan con los filtros.</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map((n, i) => `
      <tr>
        <td class="td-numero">${inicio+i+1}</td>
        <td class="td-fecha">${formatFecha(n.fecha)}</td>
        <td><strong>${n.aerop||'—'}</strong></td>
        <td>${n.area||'—'}</td>
        <td class="td-dependencia">${n.dependencia||'—'}</td>
        <td class="td-sistema" title="${n.sistema||''}">${n.sistema||'—'}</td>
        <td class="td-motivo" title="${n.motivo||''}">${n.motivo||'—'}</td>
        <td>${badgeImpacto(n.impacto)}</td>
        <td>${badgeCrit(n.criticidad)}</td>
        <td>${badgeEstado(n)}</td>
        <td class="td-dias">${diasDesde(n)}</td>
        <td class="td-acciones">
          <button class="btn btn-secundario btn-pequeño" onclick="verDetalle('${n.id}')" title="Ver detalle">👁</button>
          <button class="btn btn-secundario btn-pequeño" onclick="abrirEditar('${n.id}')" title="Editar">✏️</button>
          <button class="btn btn-peligro btn-pequeño" onclick="eliminarDirecto('${n.id}')" title="Eliminar">🗑</button>
        </td>
      </tr>
    `).join('');
  }
  renderPaginacion(total);
}
function renderPaginacion(total) {
  const totalPag = Math.ceil(total / POR_PAGINA);
  const el = document.getElementById('paginacion');
  if (totalPag <= 1) { el.innerHTML=''; return; }
  let html = `<span>${total} registros</span>`;
  html += `<button onclick="irPag(${paginaActual-1})" ${paginaActual<=1?'disabled':''}>‹</button>`;
  for (let p=1;p<=totalPag;p++) {
    if (p===1||p===totalPag||Math.abs(p-paginaActual)<=1) {
      html += `<button class="${p===paginaActual?'activo':''}" onclick="irPag(${p})">${p}</button>`;
    } else if (Math.abs(p-paginaActual)===2) {
      html += `<span>…</span>`;
    }
  }
  html += `<button onclick="irPag(${paginaActual+1})" ${paginaActual>=totalPag?'disabled':''}>›</button>`;
  el.innerHTML = html;
}
function irPag(p) { paginaActual=p; renderTabla(); }
 
// === FORMULARIO NUEVA ===
function limpiarFormulario() {
  ['f-fecha','f-aerop','f-area','f-dependencia','f-sistema','f-estado-ini',
   'f-criticidad','f-impacto','f-motivo','f-obs','f-notam','f-evidencia','f-plan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-fecha').value = hoy();
  document.getElementById('alerta-form').className = 'oculto';
  document.querySelectorAll('.msg-error').forEach(e=>e.classList.add('oculto'));
  document.querySelectorAll('.form-grupo input.error, .form-grupo select.error').forEach(e=>e.classList.remove('error'));
}
function validarCampo(id, errId) {
  const el = document.getElementById(id);
  const err = document.getElementById(errId);
  if (!el.value.trim()) {
    el.classList.add('error'); err.classList.remove('oculto'); return false;
  }
  el.classList.remove('error'); err.classList.add('oculto'); return true;
}
async function guardarNovedad() {
  let ok = true;
  ok = validarCampo('f-fecha','err-fecha') && ok;
  ok = validarCampo('f-aerop','err-aerop') && ok;
  ok = validarCampo('f-area','err-area') && ok;
  ok = validarCampo('f-sistema','err-sistema') && ok;
  ok = validarCampo('f-estado-ini','err-estado-ini') && ok;
  ok = validarCampo('f-criticidad','err-criticidad') && ok;
  ok = validarCampo('f-impacto','err-impacto') && ok;
  ok = validarCampo('f-motivo','err-motivo') && ok;
  if (!ok) {
    mostrarAlerta('alerta-form','error','⚠ Completá todos los campos obligatorios marcados en rojo.');
    return;
  }
  if (document.getElementById('f-fecha').value > hoy()) {
    mostrarAlerta('alerta-form', 'error', '⚠ La fecha no puede ser una fecha futura.');
    return;
  }
  const estado = document.getElementById('f-estado-ini').value;
  const nov = {
    id: nuevoId(),
    fecha: document.getElementById('f-fecha').value,
    aerop: document.getElementById('f-aerop').value,
    area: document.getElementById('f-area').value,
    dependencia: document.getElementById('f-dependencia').value,
    sistema: document.getElementById('f-sistema').value.trim(),
    estado: estado,
    motivo: document.getElementById('f-motivo').value.trim(),
    impacto: document.getElementById('f-impacto').value,
    obs: document.getElementById('f-obs').value.trim(),
    notam: document.getElementById('f-notam').value.trim(),
    evidencia: document.getElementById('f-evidencia').value.trim(),
    criticidad: document.getElementById('f-criticidad').value,
    fechaFin: (estado === 'Solucionado' || estado === 'Finalizada') ? hoy() : '',
    plan: document.getElementById('f-plan').value.trim(),
    estadoFin: '',
  };
  const btnGuardar = document.querySelector('#vista-nueva .btn-primario');
  btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...';
  try {
    await apiPost('/novedades', nov);
    await cargarNovedades();
    poblarFiltros(); aplicarFiltros();
    limpiarFormulario();
    mostrarAlerta('alerta-form','exito','✔ Novedad guardada correctamente.');
    setTimeout(()=>{ mostrarVista('lista'); }, 1200);
  } catch(e) {
    mostrarAlerta('alerta-form','error','❌ No se pudo guardar. Verificá la conexión con el servidor.');
  } finally {
    btnGuardar.disabled = false; btnGuardar.textContent = '✔ Guardar Novedad';
  }
}
function mostrarAlerta(id, tipo, msg) {
  const el = document.getElementById(id);
  el.className = `alerta alerta-${tipo}`;
  el.textContent = msg;
}
 
// === EDITAR / ELIMINAR ===
function abrirEditar(id) {
  const n = novedades.find(x=>x.id===id);
  if (!n) return;
  editandoId = id;
  const set = (fId, val) => { const el=document.getElementById(fId); if(el) el.value=val||''; };
  set('m-fecha', n.fecha);
  set('m-aerop', n.aerop);
  set('m-area', n.area);
  set('m-dependencia', n.dependencia);
  set('m-sistema', n.sistema);
  set('m-estado', n.estado);
  set('m-criticidad', n.criticidad);
  set('m-impacto', n.impacto);
  set('m-motivo', n.motivo);
  set('m-obs', n.obs);
  set('m-notam', n.notam);
  set('m-evidencia', n.evidencia);
  set('m-plan', n.plan);
  document.getElementById('alerta-modal').className='oculto';
  document.getElementById('modal-editar').classList.remove('oculto');
}
function cerrarModal() {
  document.getElementById('modal-editar').classList.add('oculto');
  editandoId = null;
}
async function guardarEdicion() {
  const get = id => document.getElementById(id).value;
  const estadoActual = get('m-estado');
  const novedadOriginal = novedades.find(x => x.id === editandoId);
  const estabaCerrada = novedadOriginal && (novedadOriginal.estado === 'Solucionado' || novedadOriginal.estado === 'Finalizada');
  const ahoraCerrada = estadoActual === 'Solucionado' || estadoActual === 'Finalizada';

  let fechaFin = '';
  if (ahoraCerrada) {
    // Si ya tenía fechaFin guardada (estaba cerrada antes), la conservamos; si no, seteamos hoy
    fechaFin = (estabaCerrada && novedadOriginal.fechaFin) ? novedadOriginal.fechaFin : hoy();
  }

  const body = {
    fecha: get('m-fecha'), aerop: get('m-aerop'), area: get('m-area'),
    dependencia: get('m-dependencia'), sistema: get('m-sistema'),
    estado: estadoActual, criticidad: get('m-criticidad'),
    impacto: get('m-impacto'), motivo: get('m-motivo'), obs: get('m-obs'),
    notam: get('m-notam'), evidencia: get('m-evidencia'), plan: get('m-plan'),
    fechaFin: fechaFin,
    estadoFin: '',
  };
  try {
    await apiPut('/novedades/' + editandoId, body);
    await cargarNovedades();
    poblarFiltros(); aplicarFiltros(); cerrarModal();
  } catch(e) {
    mostrarAlerta('alerta-modal','error','❌ No se pudo guardar. Verificá la conexión.');
  }
}
async function eliminarNovedadModal() {
  if (!confirm('¿Seguro que querés eliminar esta novedad? Esta acción no se puede deshacer.')) return;
  try {
    await apiDelete('/novedades/' + editandoId);
    await cargarNovedades();
    poblarFiltros(); aplicarFiltros(); cerrarModal();
  } catch(e) {
    mostrarAlerta('alerta-modal','error','❌ No se pudo eliminar. Verificá la conexión.');
  }
}
 
async function eliminarDirecto(id) {
  if (!confirm('¿Seguro que querés eliminar esta novedad? Esta acción no se puede deshacer.')) return;
  try {
    await apiDelete('/novedades/' + id);
    await cargarNovedades();
    poblarFiltros(); aplicarFiltros('limpiar');
  } catch(e) {
    mostrarBannerError('No se pudo eliminar. Verificá la conexión con el servidor.');
  }
}
 
// === VER DETALLE ===
function verDetalle(id) {
  const n = novedades.find(x => x.id === id);
  if (!n) return;

  const campo = (label, valor, ancho = false) => `
    <div class="form-grupo${ancho ? ' ancho-completo' : ''}">
      <label>${label}</label>
      <div class="campo-lectura">${valor || '—'}</div>
    </div>`;

  document.getElementById('detalle-contenido').innerHTML =
    campo('Fecha inicio', formatFecha(n.fecha)) +
    campo('Aeropuerto', n.aerop) +
    campo('Área', n.area) +
    campo('Dependencia', n.dependencia) +
    campo('Sistema / Servicio', n.sistema, true) +
    campo('Estado', n.estado) +
    campo('Criticidad', n.criticidad) +
    campo('Impacto Operativo', n.impacto, true) +
    campo('Motivo', n.motivo, true) +
    campo('Observaciones', n.obs ? n.obs.replace(/\n/g, '<br>') : '', true) +
    campo('NOTAM', n.notam) +
    campo('Evidencia', n.evidencia) +
    campo('Plan de Acción', n.plan ? n.plan.replace(/\n/g, '<br>') : '', true) +
    campo('Días abierta', diasDesde(n));

  document.getElementById('modal-detalle').classList.remove('oculto');
}
function cerrarDetalle() {
  document.getElementById('modal-detalle').classList.add('oculto');
}
 
// === DASHBOARD ===
function renderDashboard() {
  renderCards(novedades, 'cards-dash');
  const aerops = ['SACO','SASA','SASJ','SANT','SANE','SANR','SANC','SANL','SAOC','SAOS'];
  const contAerop = {};
  aerops.forEach(a => contAerop[a] = novedades.filter(n=>n.aerop===a).length);
  const maxA = Math.max(...Object.values(contAerop), 1);
  document.getElementById('barras-aerop').innerHTML = aerops.map(a=>`
    <div class="barra-fila">
      <div class="barra-label">${a}</div>
      <div class="barra-track"><div class="barra-fill" style="width:${Math.round(contAerop[a]/maxA*100)}%"></div></div>
      <div class="barra-valor">${contAerop[a]}</div>
    </div>
  `).join('');
  const areas = ['ANS','CNSE','SOC','RRHH','ADM FIN','INSTRUCCION','INFRA','MANTENIMIENTO'];
  const contArea = {};
  areas.forEach(a => contArea[a] = novedades.filter(n=>n.area===a).length);
  const maxAr = Math.max(...Object.values(contArea), 1);
  document.getElementById('barras-area').innerHTML = areas.map(a=>`
    <div class="barra-fila">
      <div class="barra-label barra-label-area">${a}</div>
      <div class="barra-track"><div class="barra-fill barra-fill-area" style="width:${Math.round(contArea[a]/maxAr*100)}%"></div></div>
      <div class="barra-valor">${contArea[a]}</div>
    </div>
  `).join('');
  dibujarDona('dona-criticidad','ley-criticidad',[
    {label:'Alta', val:novedades.filter(n=>n.criticidad==='Alta').length, color:'#dc2626'},
    {label:'Media', val:novedades.filter(n=>n.criticidad==='Media').length, color:'#d97706'},
    {label:'Baja', val:novedades.filter(n=>n.criticidad==='Baja').length, color:'#16a34a'},
  ]);
  dibujarDona('dona-impacto','ley-impacto',[
    {label:'Afecta ATS', val:novedades.filter(n=>n.impacto==='Afecta ATS').length, color:'#dc2626'},
    {label:'Parcial', val:novedades.filter(n=>n.impacto==='Afectacion Parcial').length, color:'#d97706'},
    {label:'NO Afecta', val:novedades.filter(n=>n.impacto==='NO Afecta ATS').length, color:'#16a34a'},
  ]);
}
function dibujarDona(canvasId, leyId, datos) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const total = datos.reduce((s,d)=>s+d.val, 0);
  ctx.clearRect(0,0,140,140);
  if (total === 0) {
    ctx.fillStyle='#e2e8f0'; ctx.beginPath(); ctx.arc(70,70,55,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(70,70,32,0,Math.PI*2); ctx.fill();
    return;
  }
  let ang = -Math.PI/2;
  datos.forEach(d=>{
    const slice = (d.val/total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(70,70);
    ctx.arc(70,70,55,ang,ang+slice);
    ctx.closePath(); ctx.fillStyle=d.color; ctx.fill();
    ang += slice;
  });
  ctx.beginPath(); ctx.arc(70,70,32,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
  document.getElementById(leyId).innerHTML = datos.map(d=>`
    <div class="ley-item">
      <div class="ley-color" style="background:${d.color};"></div>
      <span>${d.label}: <strong>${d.val}</strong></span>
    </div>
  `).join('');
}
 
// === EXPORTAR ===
function csvEscape(v) {
  if (v==null) return '';
  v = String(v);
  if (v.includes(';')||v.includes('"')||v.includes('\n')) return '"'+v.replace(/"/g,'""')+'"';
  return v;
}
function generarCSV(datos) {
  const headers = ['ID','FECHA INICIO','AEROP','AREA','DEPENDENCIA','SISTEMA / SERVICIO',
    'ESTADO','MOTIVO','IMPACTO OPERATIVO','OBSERVACIONES','NOTAM','EVIDENCIA',
    'CRITICIDAD','PLAN DE ACCIÓN'];
  const rows = datos.map(n=>[n.id,n.fecha,n.aerop,n.area,n.dependencia,n.sistema,
    n.estado,n.motivo,n.impacto,n.obs,n.notam,n.evidencia,n.criticidad,
    n.plan].map(csvEscape).join(';'));
  return '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
}
function descargarCSV(contenido, nombre) {
  const blob = new Blob([contenido], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=nombre; a.click();
  URL.revokeObjectURL(url);
}
function exportarCSV() {
  descargarCSV(generarCSV(novedades), `novedades_eana_${hoy()}.csv`);
}
function exportarFiltrado() {
  const activas = novedades.filter(n=>n.estado==='Abierta'||n.estado==='En Curso');
  descargarCSV(generarCSV(activas), `novedades_activas_${hoy()}.csv`);
}

// === NAVEGACIÓN ===
const VISTAS = ['lista','nueva','dashboard','exportar'];
async function mostrarVista(v) {
  VISTAS.forEach(id => document.getElementById('vista-'+id).classList.add('oculto'));
  document.getElementById('vista-'+v).classList.remove('oculto');
  document.querySelectorAll('nav button').forEach((btn,i)=>{
    btn.classList.toggle('activo', VISTAS[i]===v);
  });
  if (v==='lista') {
    await cargarNovedades();
    poblarFiltros(); aplicarFiltros();
  }
  if (v==='nueva') {
    if (!document.getElementById('f-fecha').value) document.getElementById('f-fecha').value = hoy();
    document.getElementById('f-fecha').max = hoy();
  }
  if (v==='dashboard') {
    await cargarNovedades();
    renderDashboard();
  }
  if (v==='exportar') {
    await cargarNovedades();
    document.getElementById('total-exportar').textContent = novedades.length;
  }
}
 
// === INICIO ===
document.getElementById('fecha-hoy').textContent = new Date().toLocaleDateString('es-AR', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
cargarNovedades().then(()=>{ poblarFiltros(); aplicarFiltros(); });