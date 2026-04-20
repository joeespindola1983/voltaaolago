const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
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
    rejectUnauthorized: false // Necessário para o Render
  }
});

// Inicialização das tabelas no Banco de Dados
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
      
      CREATE TABLE IF NOT EXISTS location_history (
        id SERIAL PRIMARY KEY,
        boat_id INTEGER REFERENCES boats(id),
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Banco de Dados inicializado com sucesso.");
  } catch (err) {
    console.error("Erro ao inicializar banco de dados:", err);
  }
}

initDb();

// --- Rotas API ---

// Listar todos os barcos
app.get('/api/boats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar um novo barco
app.post('/api/boats', async (req, res) => {
  const { name, type } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO boats (name, type) VALUES ($1, $2) RETURNING *',
      [name, type || 'OC6']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Lógica Socket.io ---

io.on('connection', (socket) => {
  console.log('Nova conexão:', socket.id);

  // Um barco está transmitindo sua localização
  socket.on('update_location', async (data) => {
    const { boatId, lat, lng, battery } = data;
    
    if (!boatId || !lat || !lng) return;

    try {
      // 1. Atualiza o status atual do barco
      await pool.query(
        'UPDATE boats SET lat = $1, lng = $2, battery = $3, last_updated = CURRENT_TIMESTAMP WHERE id = $4',
        [lat, lng, battery, boatId]
      );

      // 2. Salva no histórico para o rastro (opcional, para exibir depois)
      await pool.query(
        'INSERT INTO location_history (boat_id, lat, lng) VALUES ($1, $2, $3)',
        [boatId, lat, lng]
      );

      // 3. Notifica todos os mapas conectados sobre a nova posição
      io.emit('location_changed', { boatId, lat, lng, battery, lastUpdated: new Date() });
      
    } catch (err) {
      console.error('Erro ao atualizar localização:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
