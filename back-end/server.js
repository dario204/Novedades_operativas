const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../front-end')));

// ─────────────────────────────────────────────
// LOGGER estructurado
// ─────────────────────────────────────────────
function log(nivel, contexto, mensaje, detalle = {}) {
  const ts = new Date().toISOString();
  const linea = `[${ts}] [${nivel.toUpperCase()}] [${contexto}] ${mensaje}`;
  if (nivel === 'error') {
    console.error(linea, Object.keys(detalle).length ? detalle : '');
  } else {
    console.log(linea, Object.keys(detalle).length ? detalle : '');
  }
}

// ─────────────────────────────────────────────
// CONEXIÓN A BASE DE DATOS
// ─────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  log('error', 'CONFIG', 'DATABASE_URL no está definida en las variables de entorno');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Evento para errores inesperados del pool (p.ej. pérdida de conexión)
pool.on('error', (err) => {
  log('error', 'DB_POOL', 'Error inesperado en el pool de conexiones', {
    message: err.message,
    code: err.code,
  });
});

// Verificar que la conexión funciona al arrancar
async function testConexion() {
  try {
    await pool.query('SELECT 1');
    log('info', 'DB', 'Conexión a la base de datos verificada correctamente');
  } catch (err) {
    log('error', 'DB', 'No se pudo conectar a la base de datos al iniciar', {
      message: err.message,
      code: err.code,
    });
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// VALORES PERMITIDOS (listas blancas)
// ─────────────────────────────────────────────
const AEROPUERTOS_VALIDOS = ['SACO','SASA','SASJ','SANT','SANE','SANR','SANC','SANL','SAOC','SAOS'];
const AREAS_VALIDAS       = ['ANS','CNSE','SOC','RRHH','ADM FIN','INSTRUCCION','INFRA','MANTENIMIENTO'];
const DEPENDENCIAS_VALIDAS = ['ACC','TWR','AISCOM','COMS','ARO AIS', ''];
const ESTADOS_VALIDOS      = ['Abierta','En Curso','Solucionado','Finalizada'];
const CRITICIDADES_VALIDAS = ['Alta','Media','Baja'];
const IMPACTOS_VALIDOS     = ['Afecta ATS','Afectacion Parcial','NO Afecta ATS'];

// ─────────────────────────────────────────────
// FUNCIÓN DE VALIDACIÓN — POST y PUT
// ─────────────────────────────────────────────
function validarCuerpoNovedad(body, esEdicion = false) {
  const errores = [];

  const { aerop, area, dependencia, sistema, estado, motivo,
          impacto, criticidad, fechaFin, fecha } = body;

  // Campos obligatorios
  if (!aerop?.trim())    errores.push('aerop: campo obligatorio');
  if (!area?.trim())     errores.push('area: campo obligatorio');
  if (!sistema?.trim())  errores.push('sistema: campo obligatorio');
  if (!estado?.trim())   errores.push('estado: campo obligatorio');
  if (!motivo?.trim())   errores.push('motivo: campo obligatorio');
  if (!impacto?.trim())  errores.push('impacto: campo obligatorio');
  if (!criticidad?.trim()) errores.push('criticidad: campo obligatorio');

  // Enumerados
  if (aerop && !AEROPUERTOS_VALIDOS.includes(aerop))
    errores.push(`aerop: valor inválido "${aerop}". Permitidos: ${AEROPUERTOS_VALIDOS.join(', ')}`);
  if (area && !AREAS_VALIDAS.includes(area))
    errores.push(`area: valor inválido "${area}". Permitidos: ${AREAS_VALIDAS.join(', ')}`);
  if (dependencia !== undefined && !DEPENDENCIAS_VALIDAS.includes(dependencia))
    errores.push(`dependencia: valor inválido "${dependencia}". Permitidos: ${DEPENDENCIAS_VALIDAS.filter(Boolean).join(', ')}`);
  if (estado && !ESTADOS_VALIDOS.includes(estado))
    errores.push(`estado: valor inválido "${estado}". Permitidos: ${ESTADOS_VALIDOS.join(', ')}`);
  if (criticidad && !CRITICIDADES_VALIDAS.includes(criticidad))
    errores.push(`criticidad: valor inválido "${criticidad}". Permitidos: ${CRITICIDADES_VALIDAS.join(', ')}`);
  if (impacto && !IMPACTOS_VALIDOS.includes(impacto))
    errores.push(`impacto: valor inválido "${impacto}". Permitidos: ${IMPACTOS_VALIDOS.join(', ')}`);

  // Formato fecha (YYYY-MM-DD)
  const reDate = /^\d{4}-\d{2}-\d{2}$/;
  if (fecha && !reDate.test(fecha))
    errores.push(`fecha: formato inválido "${fecha}". Usar YYYY-MM-DD`);
  if (fechaFin && !reDate.test(fechaFin))
    errores.push(`fechaFin: formato inválido "${fechaFin}". Usar YYYY-MM-DD`);

  // Si hay fecha_fin debe ser >= fecha inicio
  if (fecha && fechaFin && fecha > fechaFin)
    errores.push('fechaFin no puede ser anterior a la fecha de inicio');

  return errores;
}

// ─────────────────────────────────────────────
// MIDDLEWARE — logging de cada request
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  log('info', 'REQUEST', `${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
});

// ─────────────────────────────────────────────
// GET / (Raíz)
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../front-end/main.html'));
});

// ─────────────────────────────────────────────
// INIT DB
// ─────────────────────────────────────────────
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS novedades (
        id TEXT PRIMARY KEY,
        fecha DATE,
        aerop TEXT,
        area TEXT,
        dependencia TEXT,
        sistema TEXT,
        estado TEXT,
        motivo TEXT,
        impacto TEXT,
        obs TEXT,
        notam TEXT,
        evidencia TEXT,
        criticidad TEXT,
        fecha_fin DATE,
        plan TEXT,
        estado_fin TEXT,
        creado_en TIMESTAMPTZ DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    log('info', 'DB', 'Tabla novedades verificada/creada correctamente');
  } catch (err) {
    log('error', 'DB', 'Error al crear/verificar la tabla novedades', {
      message: err.message,
      code: err.code,
    });
    throw err;
  }
}

// ─────────────────────────────────────────────
// GET /novedades
// ─────────────────────────────────────────────
app.get('/novedades', async (req, res) => {
  try {
    const { aerop, area, estado, criticidad, q } = req.query;

    // Validar filtros de enumerados
    if (aerop && !AEROPUERTOS_VALIDOS.includes(aerop)) {
      log('warn', 'GET /novedades', `Filtro aerop inválido: "${aerop}"`);
      return res.status(400).json({ error: `aerop inválido. Permitidos: ${AEROPUERTOS_VALIDOS.join(', ')}` });
    }
    if (estado && !ESTADOS_VALIDOS.includes(estado)) {
      log('warn', 'GET /novedades', `Filtro estado inválido: "${estado}"`);
      return res.status(400).json({ error: `estado inválido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}` });
    }
    if (criticidad && !CRITICIDADES_VALIDAS.includes(criticidad)) {
      log('warn', 'GET /novedades', `Filtro criticidad inválido: "${criticidad}"`);
      return res.status(400).json({ error: `criticidad inválida. Permitidos: ${CRITICIDADES_VALIDAS.join(', ')}` });
    }

    let where = [], params = [], i = 1;
    if (aerop)      { where.push(`aerop = $${i++}`);      params.push(aerop); }
    if (area)       { where.push(`area = $${i++}`);       params.push(area); }
    if (estado)     { where.push(`estado = $${i++}`);     params.push(estado); }
    if (criticidad) { where.push(`criticidad = $${i++}`); params.push(criticidad); }
    if (q)          { where.push(`(sistema ILIKE $${i} OR motivo ILIKE $${i} OR obs ILIKE $${i})`); params.push(`%${q}%`); i++; }

    const sql = `SELECT * FROM novedades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC NULLS LAST, creado_en DESC`;
    const result = await pool.query(sql, params);

    log('info', 'GET /novedades', `Devueltos ${result.rowCount} registros`);
    res.json(result.rows);
  } catch (err) {
    log('error', 'GET /novedades', 'Error al consultar la base de datos', {
      message: err.message,
      code: err.code,
    });
    res.status(500).json({ error: 'Error interno al obtener novedades', detalle: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /novedades
// ─────────────────────────────────────────────
app.post('/novedades', async (req, res) => {
  try {
    const { id, fecha, aerop, area, dependencia, sistema, estado, motivo,
            impacto, obs, notam, evidencia, criticidad, fechaFin, plan, estadoFin } = req.body;

    // Validar ID
    if (!id?.trim()) {
      log('warn', 'POST /novedades', 'Petición sin ID');
      return res.status(400).json({ error: 'id: campo obligatorio' });
    }

    // Validar duplicado
    const existe = await pool.query('SELECT id FROM novedades WHERE id = $1', [id]);
    if (existe.rowCount > 0) {
      log('warn', 'POST /novedades', `ID duplicado: "${id}"`);
      return res.status(409).json({ error: `Ya existe una novedad con id "${id}"` });
    }

    // Validar cuerpo
    const errores = validarCuerpoNovedad(req.body);
    if (errores.length) {
      log('warn', 'POST /novedades', 'Validación fallida', { errores });
      return res.status(400).json({ error: 'Datos inválidos', detalle: errores });
    }

    const result = await pool.query(`
      INSERT INTO novedades (id, fecha, aerop, area, dependencia, sistema, estado, motivo,
        impacto, obs, notam, evidencia, criticidad, fecha_fin, plan, estado_fin)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [id, fecha||null, aerop, area, dependencia, sistema, estado, motivo,
       impacto, obs, notam, evidencia, criticidad, fechaFin||null, plan, estadoFin]
    );

    log('info', 'POST /novedades', `Novedad creada: ${id}`, { aerop, area, estado });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    log('error', 'POST /novedades', 'Error al insertar novedad', {
      message: err.message,
      code: err.code,
    });
    res.status(500).json({ error: 'Error interno al guardar la novedad', detalle: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /novedades/:id
// ─────────────────────────────────────────────
app.put('/novedades/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const existe = await pool.query('SELECT id FROM novedades WHERE id = $1', [id]);
    if (existe.rowCount === 0) {
      log('warn', 'PUT /novedades', `Novedad no encontrada: "${id}"`);
      return res.status(404).json({ error: `No se encontró la novedad con id "${id}"` });
    }

    // Validar cuerpo
    const errores = validarCuerpoNovedad(req.body, true);
    if (errores.length) {
      log('warn', 'PUT /novedades', 'Validación fallida al editar', { id, errores });
      return res.status(400).json({ error: 'Datos inválidos', detalle: errores });
    }

    const { fecha, aerop, area, dependencia, sistema, estado, motivo,
            impacto, obs, notam, evidencia, criticidad, fechaFin, plan, estadoFin } = req.body;

    const result = await pool.query(`
      UPDATE novedades SET
        fecha=$1, aerop=$2, area=$3, dependencia=$4, sistema=$5, estado=$6,
        motivo=$7, impacto=$8, obs=$9, notam=$10, evidencia=$11, criticidad=$12,
        fecha_fin=$13, plan=$14, estado_fin=$15, actualizado_en=NOW()
      WHERE id=$16 RETURNING *`,
      [fecha||null, aerop, area, dependencia, sistema, estado, motivo,
       impacto, obs, notam, evidencia, criticidad, fechaFin||null, plan, estadoFin, id]
    );

    log('info', 'PUT /novedades', `Novedad actualizada: ${id}`, { aerop, estado });
    res.json(result.rows[0]);
  } catch (err) {
    log('error', 'PUT /novedades', 'Error al actualizar novedad', {
      message: err.message,
      code: err.code,
    });
    res.status(500).json({ error: 'Error interno al actualizar la novedad', detalle: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /novedades/:id
// ─────────────────────────────────────────────
app.delete('/novedades/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existe = await pool.query('SELECT id FROM novedades WHERE id = $1', [id]);
    if (existe.rowCount === 0) {
      log('warn', 'DELETE /novedades', `Intento de eliminar novedad inexistente: "${id}"`);
      return res.status(404).json({ error: `No se encontró la novedad con id "${id}"` });
    }

    await pool.query('DELETE FROM novedades WHERE id=$1', [id]);
    log('info', 'DELETE /novedades', `Novedad eliminada: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    log('error', 'DELETE /novedades', 'Error al eliminar novedad', {
      message: err.message,
      code: err.code,
    });
    res.status(500).json({ error: 'Error interno al eliminar la novedad', detalle: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /novedades/resumen
// ─────────────────────────────────────────────
app.get('/novedades/resumen', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado='Abierta') AS abiertas,
        COUNT(*) FILTER (WHERE estado='En Curso') AS en_curso,
        COUNT(*) FILTER (WHERE estado='Solucionado') AS solucionadas,
        COUNT(*) FILTER (WHERE criticidad='Alta') AS criticas
      FROM novedades
    `);
    log('info', 'GET /novedades/resumen', 'Resumen calculado', r.rows[0]);
    res.json(r.rows[0]);
  } catch (err) {
    log('error', 'GET /novedades/resumen', 'Error al calcular resumen', {
      message: err.message,
      code: err.code,
    });
    res.status(500).json({ error: 'Error interno al obtener el resumen', detalle: err.message });
  }
});

// ─────────────────────────────────────────────
// MIDDLEWARE — errores no capturados (404 / 500)
// ─────────────────────────────────────────────
app.use((req, res) => {
  log('warn', 'ROUTER', `Ruta no encontrada: ${req.method} ${req.path}`);
  res.status(404).json({ error: `Ruta "${req.method} ${req.path}" no encontrada` });
});

app.use((err, req, res, next) => {
  log('error', 'GLOBAL', 'Error no manejado', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
});

// ─────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  await testConexion();
  await initDB();
  app.listen(PORT, () => log('info', 'SERVER', `Servidor corriendo en http://localhost:${PORT}`));
})();