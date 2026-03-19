const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const NOTION_VERSION = '2022-06-28';

// Load config — env vars for production (Vercel), notion-config.json for local dev
let localConfig = {};
try { localConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'notion-config.json'), 'utf8')); } catch (_) {}

const NOTION_TOKEN    = process.env.NOTION_TOKEN    || localConfig.token;
const DB_PROPIETARIOS = process.env.DB_PROPIETARIOS || localConfig.propietarios_db;
const DB_COMPRADORES  = process.env.DB_COMPRADORES  || '269c81f1-045a-80a8-b456-ede635b77e69';
const DB_CONTENIDO    = process.env.DB_CONTENIDO    || '289c81f1-045a-80ab-b82b-f5378561c45a';
const DB_OPERACIONES  = process.env.DB_OPERACIONES  || '327c81f1-045a-814d-beab-dabdef80c863';

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => res.redirect('/dashboard.html'));

// Helper: call Notion API
async function notionRequest(method, endpoint, body) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, message: data.message || 'Error de Notion' };
  return data;
}

// ── PROPIETARIOS ─────────────────────────────────────

// GET /api/propietarios
app.get('/api/propietarios', async (req, res) => {
  try {
    const data = await notionRequest('POST', `/databases/${DB_PROPIETARIOS}/query`, {
      page_size: 100,
    });
    res.json(data);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/propietarios — crear nuevo propietario
app.post('/api/propietarios', async (req, res) => {
  try {
    const { nombre, telefono, prioridad, origen, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const properties = {
      'Nombre completo': {
        title: [{ text: { content: nombre } }],
      },
      'Estado del contacto': {
        status: { name: 'Nuevo' },
      },
    };
    if (telefono) properties['Teléfono'] = { phone_number: telefono };
    if (prioridad) properties['Prioridad'] = { select: { name: prioridad } };
    if (origen) properties['Origen del contacto'] = { select: { name: origen } };
    if (notas) properties['Notas'] = { rich_text: [{ text: { content: notas } }] };

    const page = await notionRequest('POST', '/pages', {
      parent: { database_id: DB_PROPIETARIOS },
      properties,
    });
    res.json(page);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── LEAD LANDING ──────────────────────────────────────
// POST /api/lead — desde la landing page, enruta a propietarios o compradores
app.post('/api/lead', async (req, res) => {
  try {
    const { nombre, telefono, tipo } = req.body;
    if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });

    const esVendedor = tipo === 'vender';
    const dbId = esVendedor ? DB_PROPIETARIOS : DB_COMPRADORES;

    const properties = {
      'Nombre completo': { title: [{ text: { content: nombre.trim() } }] },
      'Teléfono':        { phone_number: telefono.trim() },
      'Origen del contacto': { select: { name: 'Landing' } },
      'Estado del contacto': { status: { name: 'Nuevo' } },
    };
    if (esVendedor) {
      properties['Prioridad'] = { select: { name: 'Alta' } };
    }

    const page = await notionRequest('POST', '/pages', {
      parent: { database_id: dbId },
      properties,
    });
    res.json({ ok: true, id: page.id });
  } catch (e) {
    console.error('Error Notion /api/lead:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── CONTENIDO ─────────────────────────────────────────

// GET /api/contenido
app.get('/api/contenido', async (req, res) => {
  try {
    const data = await notionRequest('POST', `/databases/${DB_CONTENIDO}/query`, {
      page_size: 100,
      sorts: [{ property: 'Fecha de grabación', direction: 'descending' }],
    });
    res.json(data);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/contenido — crear nueva pieza
app.post('/api/contenido', async (req, res) => {
  try {
    const { titulo, plataforma, estado, tipoVideo, tipoContenido, fechaGrabacion } = req.body;
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });

    const properties = {
      'Título': { title: [{ text: { content: titulo } }] },
      'Estado': { select: { name: estado || 'Idea' } },
    };
    if (plataforma)      properties['Plataforma']        = { select: { name: plataforma } };
    if (tipoVideo)       properties['Tipo de Vídeo']     = { select: { name: tipoVideo } };
    if (tipoContenido)   properties['Tipo de Contenido'] = { select: { name: tipoContenido } };
    if (fechaGrabacion)  properties['Fecha de grabación'] = { date: { start: fechaGrabacion } };

    const page = await notionRequest('POST', '/pages', {
      parent: { database_id: DB_CONTENIDO },
      properties,
    });
    res.json(page);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PATCH /api/contenido/:id — actualizar estado, métricas y link
app.patch('/api/contenido/:id', async (req, res) => {
  try {
    const { titulo, estado, viewCount, seguidores, rating, enlace } = req.body;
    const properties = {};

    if (titulo !== undefined && titulo.trim())
      properties['Título'] = { title: [{ text: { content: titulo.trim() } }] };
    if (estado !== undefined)
      properties['Estado'] = { select: { name: estado } };
    if (viewCount !== undefined && viewCount !== '')
      properties['View Count'] = { number: parseInt(viewCount) || 0 };
    if (seguidores !== undefined && seguidores !== '')
      properties['Seguidores Ganados'] = { number: parseInt(seguidores) || 0 };
    if (rating !== undefined && rating !== '')
      properties['Rating'] = { number: parseFloat(rating) || 0 };
    if (enlace !== undefined)
      properties['Enlace'] = { url: enlace || null };

    if (!Object.keys(properties).length)
      return res.status(400).json({ error: 'No hay campos para actualizar' });

    const page = await notionRequest('PATCH', `/pages/${req.params.id}`, { properties });
    res.json(page);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── OPERACIONES ────────────────────────────────────────

// GET /api/operaciones
app.get('/api/operaciones', async (req, res) => {
  try {
    const data = await notionRequest('POST', `/databases/${DB_OPERACIONES}/query`, {
      page_size: 100,
      sorts: [{ property: 'Fecha de cierre', direction: 'descending' }],
    });
    res.json(data);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/operaciones — crear nueva operación
app.post('/api/operaciones', async (req, res) => {
  try {
    const { propiedad, valorVenta, comisionDiego, comisionKDF, fechaCierre, estado, tipo, notas } = req.body;
    if (!propiedad) return res.status(400).json({ error: 'El nombre de la propiedad es obligatorio' });

    const properties = {
      'Propiedad': { title: [{ text: { content: propiedad } }] },
    };
    if (valorVenta !== undefined && valorVenta !== '')   properties['Valor de venta']      = { number: parseFloat(valorVenta) || 0 };
    if (comisionDiego !== undefined && comisionDiego !== '') properties['Comisión neta Diego'] = { number: parseFloat(comisionDiego) || 0 };
    if (comisionKDF !== undefined && comisionKDF !== '')   properties['Comisión KDF Realty']  = { number: parseFloat(comisionKDF) || 0 };
    if (fechaCierre)  properties['Fecha de cierre'] = { date: { start: fechaCierre } };
    if (estado)       properties['Estado']          = { select: { name: estado } };
    if (tipo)         properties['Tipo']            = { select: { name: tipo } };
    if (notas)        properties['Notas']           = { rich_text: [{ text: { content: notas } }] };

    const page = await notionRequest('POST', '/pages', {
      parent: { database_id: DB_OPERACIONES },
      properties,
    });
    res.json(page);
  } catch (e) {
    console.error('Error Notion:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Local dev server — Vercel ignores this and uses module.exports instead
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n✓ Panel operativo en http://localhost:${PORT}`);
    console.log(`  Token: ${NOTION_TOKEN ? NOTION_TOKEN.substring(0, 12) + '...' : '⚠ no definido'}`);
    console.log(`  DB Propietarios: ${DB_PROPIETARIOS}`);
    console.log(`  DB Contenido:    ${DB_CONTENIDO}`);
    console.log(`  DB Operaciones:  ${DB_OPERACIONES}\n`);
  });
}

module.exports = app;
