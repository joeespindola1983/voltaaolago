const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// Build Version: 2026-04-20-23-45 (Performance Mode)

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let raceStartTime = null;
let memoBoats = []; // CACHE EM RAM PARA BLINDAR O BANCO DE DADOS

const pool = new Pool({
  connectionString: 'postgresql://voltaaolago_db_user:D9QmMI4tqhLgIKqz0k6HYul0Wcm6fWVT@dpg-d7j6l89j2pic73b9n7ug-a.virginia-postgres.render.com/voltaaolago_db',
  ssl: { rejectUnauthorized: false }
});

async function refreshMemo() {
  try {
    const boats = (await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC')).rows;
    for (let boat of boats) {
      boat.trail = (await pool.query('SELECT lat, lng FROM location_history WHERE boat_id = $1 ORDER BY created_at DESC LIMIT 20', [boat.id])).rows.reverse();
    }
    memoBoats = boats;
    console.log(`Cache atualizado: ${memoBoats.length} barcos na RAM.`);
  } catch (err) { console.error("Cache Err:", err.message); }
}

async function initDb() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS boats (
        id SERIAL PRIMARY KEY, name VARCHAR(255), type VARCHAR(100), active BOOLEAN DEFAULT true,
        lat DOUBLE PRECISION, lng DOUBLE PRECISION, distance DOUBLE PRECISION DEFAULT 0,
        nickname VARCHAR(50) UNIQUE, pin VARCHAR(4) DEFAULT '1234', color VARCHAR(20),
        speed DOUBLE PRECISION DEFAULT 0, heading DOUBLE PRECISION DEFAULT 0,
        category VARCHAR(100) DEFAULT 'Geral', battery_level INTEGER DEFAULT 100,
        sos_active BOOLEAN DEFAULT false, last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE TABLE IF NOT EXISTS location_history (id SERIAL PRIMARY KEY, boat_id INTEGER REFERENCES boats(id) ON DELETE CASCADE, lat DOUBLE PRECISION, lng DOUBLE PRECISION, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS global_config (key VARCHAR(50) PRIMARY KEY, value JSONB);`);
    client.release();
    const configRes = await pool.query('SELECT * FROM global_config');
    configRes.rows.forEach(row => {
      if (row.key === 'race_start_time') raceStartTime = row.value.val;
    });
    
    // PRIMEIRA CARGA NA RAM
    await refreshMemo();
  } catch (err) { console.error("DB ERR:", err.message); }
}
initDb();

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;  
  const dLon = (lon2 - lon1) * Math.PI / 180; 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

app.get('/api/config', (req, res) => res.json({ raceStartTime }));
app.post('/api/config', async (req, res) => {
  const { raceStartTime: newStartTime } = req.body;
  if (newStartTime !== undefined) {
    raceStartTime = newStartTime;
    await pool.query('INSERT INTO global_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['race_start_time', { val: raceStartTime }]);
  }
  io.emit('config_updated', { raceStartTime });
  res.json({ success: true });
});

// ROTA BLINDADA: RESPONDE DA RAM SEM TOCAR NO BANCO
app.get('/api/boats', (req, res) => res.json(memoBoats));

app.post('/api/boats/auth', async (req, res) => {
  const result = await pool.query('SELECT * FROM boats WHERE LOWER(nickname) = LOWER($1)', [req.body.nickname]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Não encontrado' });
  res.json(result.rows[0]);
});

app.post('/api/boats/:id/take_control', async (req, res) => {
  io.emit('control_taken', { boatId: parseInt(req.params.id), senderId: req.body.senderId });
  res.json({ success: true });
});

app.post('/api/admin/reset_all', async (req, res) => {
  await pool.query('UPDATE boats SET distance = 0, speed = 0, lat = NULL, lng = NULL, sos_active = false');
  await pool.query('DELETE FROM location_history');
  await refreshMemo();
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));

io.on('connection', (socket) => {
  socket.emit('config_updated', { raceStartTime });
  
  socket.on('update_location', async (data) => {
    const { boatId, lat, lng, speed, heading, batteryLevel } = data;
    if (!boatId || !lat || !lng) return;

    // ATUALIZA IMEDIATAMENTE NA RAM PARA TODOS OS USUÁRIOS
    const now = new Date();
    const boatIdx = memoBoats.findIndex(b => Number(b.id) === Number(boatId));
    
    if (boatIdx !== -1) {
      let currentDistance = parseFloat(memoBoats[boatIdx].distance) || 0;
      if (raceStartTime && memoBoats[boatIdx].lat) {
        const distKm = getDistance(memoBoats[boatIdx].lat, memoBoats[boatIdx].lng, lat, lng);
        if (distKm > 0.005 && distKm < 0.5) currentDistance += distKm;
      }
      
      // Update RAM
      memoBoats[boatIdx].lat = lat;
      memoBoats[boatIdx].lng = lng;
      memoBoats[boatIdx].distance = currentDistance;
      memoBoats[boatIdx].speed = (speed * 3.6) || 0;
      memoBoats[boatIdx].heading = heading || 0;
      memoBoats[boatIdx].battery_level = batteryLevel || 100;
      memoBoats[boatIdx].last_updated = now;
      
      // Update trail in RAM (limit 20 points)
      if (!memoBoats[boatIdx].trail) memoBoats[boatIdx].trail = [];
      memoBoats[boatIdx].trail.push({ lat, lng });
      if (memoBoats[boatIdx].trail.length > 20) memoBoats[boatIdx].trail.shift();

      // TRANSMITE PARA O PÚBLICO IMEDIATAMENTE DA RAM
      io.emit('location_changed', { 
        boatId, lat, lng, distance: currentDistance, 
        speed: (speed * 3.6) || 0, heading: heading || 0, 
        batteryLevel, lastUpdated: now 
      });

      // SALVA NO BANCO EM SEGUNDO PLANO (SEM BLOQUEAR O SOCKET)
      pool.query('UPDATE boats SET lat = $1, lng = $2, distance = $3, speed = $4, heading = $5, battery_level = $6, last_updated = CURRENT_TIMESTAMP WHERE id = $7', 
        [lat, lng, currentDistance, (speed*3.6)||0, heading||0, batteryLevel||100, boatId]
      ).catch(e => console.error("Update DB Err:", e.message));

      if (raceStartTime) {
        pool.query('INSERT INTO location_history (boat_id, lat, lng) VALUES ($1, $2, $3)', [boatId, lat, lng]).catch(() => {});
      }
    }
  });
});

server.listen(process.env.PORT || 3001, () => console.log('Server Performance Mode OK'));
