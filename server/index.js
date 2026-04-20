const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuração do Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Inicialização das tabelas
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boats (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100) DEFAULT 'OC6',
        active BOOLEAN DEFAULT true,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        battery INTEGER
      );
    `);
    console.log("Banco de Dados ok.");
  } catch (err) {
    console.error("Erro DB:", err);
  }
}
initDb();

// --- Rotas API ---
app.get('/api/boats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/boats', async (req, res) => {
  const { name, type } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO boats (name, type) VALUES ($1, $2) RETURNING *',
      [name, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SERVIR FRONTEND ESTÁTICO ---
// Servir os arquivos da build do React
app.use(express.static(path.join(__dirname, '../client/dist')));

// Qualquer outra rota cai no index.html do React (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('update_location', async (data) => {
    const { boatId, lat, lng, battery } = data;
    if (!boatId || !lat || !lng) return;
    try {
      await pool.query(
        'UPDATE boats SET lat = $1, lng = $2, battery = $3, last_updated = CURRENT_TIMESTAMP WHERE id = $4',
        [lat, lng, battery, boatId]
      );
      io.emit('location_changed', { boatId, lat, lng, battery, lastUpdated: new Date() });
    } catch (err) {
      console.error('Erro Socket update:', err);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
