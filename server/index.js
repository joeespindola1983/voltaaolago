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
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// --- CONFIGURAÇÃO GLOBAL ---
let globalRelayTimeout = 1; // em minutos

// --- BANCO DE DADOS ---
const connectionString = 'postgresql://voltaaolago_db_user:D9QmMI4tqhLgIKqz0k6HYul0Wcm6fWVT@dpg-d7j6l89j2pic73b9n7ug-a.virginia-postgres.render.com/voltaaolago_db';

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false 
  }
});

// Inicialização de tabelas e atualizações de esquema
async function initDb() {
  try {
    const client = await pool.connect();
    console.log("Conectado ao Postgres com sucesso!");
    
    // Criação inicial da tabela
    await client.query(`
      CREATE TABLE IF NOT EXISTS boats (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100) DEFAULT 'OC6',
        active BOOLEAN DEFAULT true,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Adicionando novas colunas para o sistema de remadores e distância
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS distance DOUBLE PRECISION DEFAULT 0;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS current_crew JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS crew_queue JSONB DEFAULT '[]'::jsonb;`);
    
    client.release();
    console.log("Tabelas prontas e atualizadas.");
  } catch (err) {
    console.error("ERRO AO INICIAR BANCO:", err.message);
  }
}
initDb();

// --- FUNÇÃO PARA CALCULAR DISTÂNCIA (Fórmula de Haversine) ---
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;  
  const dLon = (lon2 - lon1) * Math.PI / 180; 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
}

// --- ROTAS ---

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db_time: result.rows[0].now, relayTimeout: globalRelayTimeout });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ relayTimeout: globalRelayTimeout });
});

app.post('/api/config', (req, res) => {
  const { relayTimeout } = req.body;
  if (relayTimeout) {
    globalRelayTimeout = parseInt(relayTimeout) || 1;
    io.emit('config_updated', { relayTimeout: globalRelayTimeout });
  }
  res.json({ success: true, relayTimeout: globalRelayTimeout });
});

app.get('/api/boats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro no Banco', details: err.message });
  }
});

app.post('/api/boats', async (req, res) => {
  const { name, type, current_crew } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO boats (name, type, current_crew) VALUES ($1, $2, $3) RETURNING *',
      [name, type, JSON.stringify(current_crew || [])]
    );
    io.emit('boat_updated', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adicionar à fila de troca
app.post('/api/boats/:id/queue', async (req, res) => {
  const { id } = req.params;
  const { crew } = req.body; // Array de nomes
  try {
    const boatRes = await pool.query('SELECT crew_queue FROM boats WHERE id = $1', [id]);
    if (boatRes.rows.length === 0) return res.status(404).json({ error: 'Barco não encontrado' });
    
    let queue = boatRes.rows[0].crew_queue || [];
    queue.push(crew);
    
    await pool.query('UPDATE boats SET crew_queue = $1 WHERE id = $2', [JSON.stringify(queue), id]);
    
    // Notificar clientes sobre a atualização do barco
    const updatedBoat = await pool.query('SELECT * FROM boats WHERE id = $1', [id]);
    io.emit('boat_updated', updatedBoat.rows[0]);
    
    res.json({ success: true, queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tomar controle do barco
app.post('/api/boats/:id/take_control', async (req, res) => {
  const { id } = req.params;
  const { new_crew } = req.body;
  try {
    const boatRes = await pool.query('SELECT crew_queue FROM boats WHERE id = $1', [id]);
    if (boatRes.rows.length === 0) return res.status(404).json({ error: 'Barco não encontrado' });
    
    let queue = boatRes.rows[0].crew_queue || [];
    // Tenta remover essa crew da fila (simplificado)
    queue = queue.filter(q => JSON.stringify(q) !== JSON.stringify(new_crew));
    
    const result = await pool.query(
      'UPDATE boats SET current_crew = $1, crew_queue = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(new_crew), JSON.stringify(queue), id]
    );
    
    // Notificar clientes antigos para pararem de transmitir
    io.emit('control_taken', { boatId: parseInt(id), timestamp: Date.now() });
    // Atualizar dados gerais do barco
    io.emit('boat_updated', result.rows[0]);
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover um barco completamente
app.delete('/api/boats/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM boats WHERE id = $1', [id]);
    io.emit('boat_deleted', { id: parseInt(id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover uma equipe da fila
app.delete('/api/boats/:id/queue/:index', async (req, res) => {
  const { id, index } = req.params;
  try {
    const boatRes = await pool.query('SELECT crew_queue FROM boats WHERE id = $1', [id]);
    if (boatRes.rows.length === 0) return res.status(404).json({ error: 'Barco não encontrado' });
    
    let queue = boatRes.rows[0].crew_queue || [];
    queue.splice(parseInt(index), 1);
    
    await pool.query('UPDATE boats SET crew_queue = $1 WHERE id = $2', [JSON.stringify(queue), id]);
    
    const updatedBoat = await pool.query('SELECT * FROM boats WHERE id = $1', [id]);
    io.emit('boat_updated', updatedBoat.rows[0]);
    
    res.json({ success: true, queue });
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
  // Enviar configuração atual ao conectar
  socket.emit('config_updated', { relayTimeout: globalRelayTimeout });

  socket.on('update_location', async (data) => {
    const { boatId, lat, lng } = data;
    if (!boatId || !lat || !lng) return;
    try {
      const resBoat = await pool.query('SELECT lat, lng, distance FROM boats WHERE id = $1', [boatId]);
      if (resBoat.rows.length === 0) return;
      
      const oldLat = resBoat.rows[0].lat;
      const oldLng = resBoat.rows[0].lng;
      let distance = parseFloat(resBoat.rows[0].distance) || 0;
      
      // Calcular distância se já tinha posição anterior
      if (oldLat && oldLng) {
        const distKm = getDistance(oldLat, oldLng, lat, lng);
        // Filtrar ruído de GPS (só soma se moveu mais de 5 metros e menos de 2km por minuto para evitar saltos irreais)
        if (distKm > 0.005 && distKm < 2.0) {
          distance += distKm;
        }
      }
      
      await pool.query(
        'UPDATE boats SET lat = $1, lng = $2, distance = $3, last_updated = CURRENT_TIMESTAMP WHERE id = $4',
        [lat, lng, distance, boatId]
      );
      
      io.emit('location_changed', { boatId, lat, lng, distance, lastUpdated: new Date() });
    } catch (err) {
      console.error('Erro Socket:', err.message);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
