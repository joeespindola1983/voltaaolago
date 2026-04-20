const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

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

// --- BANCO DE DADOS (HARDCODED PARA VELOCIDADE) ---
const connectionString = 'postgresql://voltaaolago_db_user:D9QmMI4tqhLgIKqz0k6HYul0Wcm6fWVT@dpg-d7j6l89j2pic73b9n7ug-a.virginia-postgres.render.com/voltaaolago_db';

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false 
  }
});

// Inicialização de tabelas
async function initDb() {
  try {
    const client = await pool.connect();
    console.log("Conectado ao Postgres com sucesso!");
    await client.query(`
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
    client.release();
    console.log("Tabelas prontas.");
  } catch (err) {
    console.error("ERRO AO INICIAR BANCO:", err.message);
  }
}
initDb();

// --- ROTAS ---

// Rota de Teste (Acesse no navegador para ver se o banco responde)
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/api/boats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro na query /api/boats:', err.message);
    res.status(500).json({ error: 'Erro no Banco', details: err.message });
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

// Fallback para Frontend se estiver no mesmo servidor
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(200).send("API Online. Frontend não encontrado nesta rota.");
  });
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
