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

// Configuração do Banco de Dados com fallback para debug
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false // Obrigatório para Render
  }
});

// Testar conexão imediatamente
pool.connect((err, client, release) => {
  if (err) {
    return console.error('ERRO CRÍTICO: Não foi possível conectar ao banco de dados!', err.stack);
  }
  console.log('Conexão com o Banco de Dados estabelecida com sucesso.');
  release();
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
    console.log("Tabela 'boats' verificada/criada.");
  } catch (err) {
    console.error("Erro ao criar tabelas:", err);
  }
}
initDb();

// --- Rotas API ---

app.get('/api/boats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro na rota /api/boats:', err.message);
    res.status(500).json({ error: 'Erro no Banco de Dados', details: err.message });
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
    console.error('Erro ao criar barco:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Servir Frontend
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('update_location', async (data) => {
    const { boatId, lat, lng, battery } = data;
    if (!boatId) return;
    try {
      await pool.query(
        'UPDATE boats SET lat = $1, lng = $2, battery = $3, last_updated = CURRENT_TIMESTAMP WHERE id = $4',
        [lat, lng, battery, boatId]
      );
      io.emit('location_changed', { boatId, lat, lng, battery, lastUpdated: new Date() });
    } catch (err) {
      console.error('Erro Socket:', err.message);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
