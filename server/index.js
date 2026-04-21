const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

let globalRelayTimeout = 1;
let raceStartTime = null;
let lastBroadcast = { message: '', timestamp: null };

const connectionString = 'postgresql://voltaaolago_db_user:D9QmMI4tqhLgIKqz0k6HYul0Wcm6fWVT@dpg-d7j6l89j2pic73b9n7ug-a.virginia-postgres.render.com/voltaaolago_db';

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS boats (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100) DEFAULT 'OC6',
        active BOOLEAN DEFAULT true,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        distance DOUBLE PRECISION DEFAULT 0,
        nickname VARCHAR(50) UNIQUE,
        pin VARCHAR(4) DEFAULT '1234',
        color VARCHAR(20) DEFAULT '#2563eb',
        speed DOUBLE PRECISION DEFAULT 0,
        heading DOUBLE PRECISION DEFAULT 0,
        category VARCHAR(100) DEFAULT 'Geral',
        battery_level INTEGER DEFAULT 100,
        sos_active BOOLEAN DEFAULT false,
        athletes JSONB DEFAULT '[]'::jsonb,
        exchanges JSONB DEFAULT '[]'::jsonb,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE TABLE IF NOT EXISTS location_history (id SERIAL PRIMARY KEY, boat_id INTEGER REFERENCES boats(id) ON DELETE CASCADE, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS global_config (key VARCHAR(50) PRIMARY KEY, value JSONB);`);
    client.release();
    const configRes = await pool.query('SELECT * FROM global_config');
    configRes.rows.forEach(row => {
      if (row.key === 'relay_timeout') globalRelayTimeout = row.value.val;
      if (row.key === 'race_start_time') raceStartTime = row.value.val;
      if (row.key === 'last_broadcast') lastBroadcast = row.value;
    });
  } catch (err) { console.error("ERRO BANCO:", err.message); }
}
initDb();

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;  
  const dLon = (lon2 - lon1) * Math.PI / 180; 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
}

app.get('/api/config', (req, res) => res.json({ relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast }));

app.post('/api/config', async (req, res) => {
  const { relayTimeout, raceStartTime: newStartTime, broadcast } = req.body;
  if (relayTimeout) {
    globalRelayTimeout = parseInt(relayTimeout) || 1;
    await pool.query('INSERT INTO global_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['relay_timeout', { val: globalRelayTimeout }]);
  }
  if (newStartTime !== undefined) {
    raceStartTime = newStartTime;
    await pool.query('INSERT INTO global_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['race_start_time', { val: raceStartTime }]);
  }
  if (broadcast !== undefined) {
    lastBroadcast = { message: broadcast, timestamp: broadcast ? Date.now() : null };
    await pool.query('INSERT INTO global_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['last_broadcast', lastBroadcast]);
    io.emit('broadcast_received', lastBroadcast);
  }
  io.emit('config_updated', { relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast });
  res.json({ success: true });
});

app.get('/api/boats', async (req, res) => {
  const boats = (await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC')).rows;
  for (let boat of boats) {
    boat.trail = (await pool.query('SELECT lat, lng FROM location_history WHERE boat_id = $1 ORDER BY created_at DESC LIMIT 30', [boat.id])).rows.reverse();
  }
  res.json(boats);
});

app.post('/api/boats/auth', async (req, res) => {
  const result = await pool.query('SELECT * FROM boats WHERE LOWER(nickname) = LOWER($1)', [req.body.nickname]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Não encontrado' });
  res.json(result.rows[0]);
});

app.post('/api/boats', async (req, res) => {
  const { name, type, nickname, color, category } = req.body;
  const result = await pool.query('INSERT INTO boats (name, type, nickname, color, category) VALUES ($1, $2, $3, $4, $5) RETURNING *', [name, type, nickname, color || '#2563eb', category || 'Geral']);
  io.emit('boat_updated', result.rows[0]);
  res.json(result.rows[0]);
});

app.put('/api/boats/:id', async (req, res) => {
  const { name, nickname, color, category } = req.body;
  const result = await pool.query('UPDATE boats SET name = $1, nickname = $2, color = $3, category = $4 WHERE id = $5 RETURNING *', [name, nickname, color, category || 'Geral', req.params.id]);
  io.emit('boat_updated', result.rows[0]);
  res.json(result.rows[0]);
});

// AQUI: Adicionado senderId para evitar autodesconexão
app.post('/api/boats/:id/take_control', async (req, res) => {
  io.emit('control_taken', { boatId: parseInt(req.params.id), senderId: req.body.senderId });
  res.json({ success: true });
});

app.delete('/api/boats/:id', async (req, res) => {
  await pool.query('DELETE FROM boats WHERE id = $1', [req.params.id]);
  io.emit('boat_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

app.post('/api/boats/:id/reset', async (req, res) => {
  await pool.query('UPDATE boats SET distance = 0, speed = 0, lat = NULL, lng = NULL, sos_active = false WHERE id = $1', [req.params.id]);
  await pool.query('DELETE FROM location_history WHERE boat_id = $1', [req.params.id]);
  const updated = await pool.query('SELECT * FROM boats WHERE id = $1', [req.params.id]);
  io.emit('boat_updated', updated.rows[0]);
  res.json({ success: true });
});

app.post('/api/admin/reset_all', async (req, res) => {
  await pool.query('UPDATE boats SET distance = 0, speed = 0, lat = NULL, lng = NULL, sos_active = false');
  await pool.query('DELETE FROM location_history');
  io.emit('config_updated', { relayTimeout: globalRelayTimeout, raceStartTime: null });
  res.json({ success: true });
});

app.get('/api/admin/export', async (req, res) => {
  const boats = (await pool.query('SELECT * FROM boats ORDER BY category, distance DESC')).rows;
  let csv = 'Posicao,Barco,Categoria,Nickname,Distancia_km\n';
  boats.forEach((b, i) => { csv += `${i + 1},"${b.name}","${b.category}",${b.nickname},${b.distance.toFixed(2)}\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=resultados.csv');
  res.send(csv);
});

app.get('/api/waypoints', async (req, res) => res.json((await pool.query('SELECT * FROM waypoints ORDER BY id ASC')).rows));
app.post('/api/waypoints', async (req, res) => {
  const result = await pool.query('INSERT INTO waypoints (name, lat, lng) VALUES ($1, $2, $3) RETURNING *', [req.body.name, req.body.lat, req.body.lng]);
  io.emit('waypoints_updated', result.rows[0]);
  res.json(result.rows[0]);
});
app.delete('/api/waypoints/:id', async (req, res) => {
  await pool.query('DELETE FROM waypoints WHERE id = $1', [req.params.id]);
  io.emit('waypoints_deleted', { id: req.params.id });
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));

io.on('connection', (socket) => {
  socket.emit('config_updated', { relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast });
  socket.on('update_location', async (data) => {
    const { boatId, lat, lng, speed, heading, batteryLevel } = data;
    if (!boatId || !lat || !lng) return;
    try {
      const resBoat = await pool.query('SELECT lat, lng, distance FROM boats WHERE id = $1', [boatId]);
      if (resBoat.rows.length === 0) return;
      const oldLat = resBoat.rows[0].lat;
      const oldLng = resBoat.rows[0].lng;
      let distance = parseFloat(resBoat.rows[0].distance) || 0;
      if (raceStartTime && oldLat && oldLng) {
        const distKm = getDistance(oldLat, oldLng, lat, lng);
        if (distKm > 0.005 && distKm < 2.0) distance += distKm;
      }
      const currentSpeed = speed ? (speed * 3.6).toFixed(1) : 0;
      await pool.query('UPDATE boats SET lat = $1, lng = $2, distance = $3, speed = $4, heading = $5, battery_level = $6, last_updated = CURRENT_TIMESTAMP WHERE id = $7', [lat, lng, distance, currentSpeed, heading || 0, batteryLevel || 100, boatId]);
      if (raceStartTime) await pool.query('INSERT INTO location_history (boat_id, lat, lng) VALUES ($1, $2, $3)', [boatId, lat, lng]);
      io.emit('location_changed', { boatId, lat, lng, distance, speed: currentSpeed, heading: heading || 0, batteryLevel, lastUpdated: new Date() });
    } catch (err) { console.error('Erro Socket:', err.message); }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Porta ${PORT}`));
