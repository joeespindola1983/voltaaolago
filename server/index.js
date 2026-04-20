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
let raceStartTime = null; // timestamp de início da prova
let lastBroadcast = { message: '', timestamp: null };

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
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS nickname VARCHAR(50) UNIQUE;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS pin VARCHAR(4);`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#2563eb';`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION DEFAULT 0;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION DEFAULT 0;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'Geral';`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS battery_level INTEGER DEFAULT 100;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS sos_active BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS athletes JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS exchanges JSONB DEFAULT '[]'::jsonb;`);
    
    // Tabela para armazenar o rastro dos barcos
    await client.query(`
      CREATE TABLE IF NOT EXISTS location_history (
        id SERIAL PRIMARY KEY,
        boat_id INTEGER REFERENCES boats(id) ON DELETE CASCADE,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Tabela para armazenar o log de trocas (tempos por trecho)
    await client.query(`
      CREATE TABLE IF NOT EXISTS exchange_logs (
        id SERIAL PRIMARY KEY,
        boat_id INTEGER REFERENCES boats(id) ON DELETE CASCADE,
        exchange_index INTEGER NOT NULL,
        crew JSONB NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP
      );
    `);
    
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
  res.json({ relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast });
});

app.post('/api/config', (req, res) => {
  const { relayTimeout, raceStartTime: newStartTime, broadcast } = req.body;
  if (relayTimeout) {
    globalRelayTimeout = parseInt(relayTimeout) || 1;
  }
  if (newStartTime !== undefined) {
    raceStartTime = newStartTime;
  }
  if (broadcast !== undefined) {
    lastBroadcast = { message: broadcast, timestamp: broadcast ? Date.now() : null };
    io.emit('broadcast_received', lastBroadcast);
  }
  io.emit('config_updated', { relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast });
  res.json({ success: true, relayTimeout: globalRelayTimeout, raceStartTime, lastBroadcast });
});

app.get('/api/boats', async (req, res) => {
  try {
    const boatsResult = await pool.query('SELECT * FROM boats WHERE active = true ORDER BY name ASC');
    const boats = boatsResult.rows;

    // Para cada barco, buscar os últimos 30 pontos de rastro
    for (let boat of boats) {
      const historyResult = await pool.query(
        'SELECT lat, lng FROM location_history WHERE boat_id = $1 ORDER BY created_at DESC LIMIT 30',
        [boat.id]
      );
      boat.trail = historyResult.rows.reverse(); // Ordem cronológica para o Leaflet
    }

    res.json(boats);
  } catch (err) {
    res.status(500).json({ error: 'Erro no Banco', details: err.message });
  }
});

// Autenticação de Barco (Nickname + PIN)
app.post('/api/boats/auth', async (req, res) => {
  const { nickname, pin } = req.body;
  try {
    const result = await pool.query('SELECT * FROM boats WHERE LOWER(nickname) = LOWER($1) AND pin = $2', [nickname, pin]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Nickname ou PIN incorretos' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/boats', async (req, res) => {
  const { name, type, nickname, pin, color, category, athletes, exchanges } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO boats (name, type, nickname, pin, color, category, athletes, exchanges) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [name, type, nickname, pin, color || '#2563eb', category || 'Geral', JSON.stringify(athletes || []), JSON.stringify(exchanges || [])]
    );
    io.emit('boat_updated', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Este Nickname já está em uso.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/boats/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, nickname, pin, color, category, athletes, exchanges } = req.body;
  try {
    const result = await pool.query(
      'UPDATE boats SET name = $1, type = $2, nickname = $3, pin = $4, color = $5, category = $6, athletes = $7, exchanges = $8 WHERE id = $9 RETURNING *',
      [name, type, nickname, pin, color, category || 'Geral', JSON.stringify(athletes || []), JSON.stringify(exchanges || []), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Barco não encontrado' });
    io.emit('boat_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Este Nickname já está em uso.' });
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

// Tomar controle do barco (Troca de tripulação)
app.post('/api/boats/:id/take_control', async (req, res) => {
  const { id } = req.params;
  const { new_crew, exchange_index } = req.body;
  try {
    const boatRes = await pool.query('SELECT crew_queue FROM boats WHERE id = $1', [id]);
    if (boatRes.rows.length === 0) return res.status(404).json({ error: 'Barco não encontrado' });

    // Finalizar o trecho anterior (se houver)
    await pool.query(
      'UPDATE exchange_logs SET end_time = CURRENT_TIMESTAMP WHERE boat_id = $1 AND end_time IS NULL',
      [id]
    );

    // Iniciar o novo trecho no log
    if (exchange_index !== undefined) {
      await pool.query(
        'INSERT INTO exchange_logs (boat_id, exchange_index, crew) VALUES ($1, $2, $3)',
        [id, exchange_index, JSON.stringify(new_crew || [])]
      );
    }

    let queue = boatRes.rows[0].crew_queue || [];
    queue = queue.filter(q => JSON.stringify(q) !== JSON.stringify(new_crew));

    const result = await pool.query(
      'UPDATE boats SET current_crew = $1, crew_queue = $2, last_updated = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
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

// Resetar distância e histórico de um barco
app.post('/api/boats/:id/reset', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE boats SET distance = 0, speed = 0, lat = NULL, lng = NULL, sos_active = false WHERE id = $1', [id]);
    await pool.query('DELETE FROM location_history WHERE boat_id = $1', [id]);
    await pool.query('DELETE FROM exchange_logs WHERE boat_id = $1', [id]);
    const updated = await pool.query('SELECT * FROM boats WHERE id = $1', [id]);
    io.emit('boat_updated', updated.rows[0]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resetar TODOS os barcos (Ação Global Admin)
app.post('/api/admin/reset_all', async (req, res) => {
  try {
    await pool.query('UPDATE boats SET distance = 0, speed = 0, lat = NULL, lng = NULL, sos_active = false');
    await pool.query('DELETE FROM location_history');
    await pool.query('DELETE FROM exchange_logs');
    io.emit('config_updated', { relayTimeout: globalRelayTimeout, raceStartTime: null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar resultados consolidados em CSV
app.get('/api/admin/export', async (req, res) => {
  try {
    const boatsRes = await pool.query('SELECT * FROM boats ORDER BY category, distance DESC');
    const boats = boatsRes.rows;
    
    let csv = 'Posicao,Barco,Categoria,Nickname,Distancia_km,Ritmo_Medio,Status,Trechos_Info\n';
    
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      const splitsRes = await pool.query(
        'SELECT exchange_index, start_time, end_time FROM exchange_logs WHERE boat_id = $1 ORDER BY exchange_index',
        [b.id]
      );
      
      const splitsInfo = splitsRes.rows.map(s => {
        const start = new Date(s.start_time);
        const end = s.end_time ? new Date(s.end_time) : new Date();
        const durationMin = Math.round((end - start) / 60000);
        return `T${s.exchange_index + 1}:${durationMin}min`;
      }).join(' | ');

      csv += `${i + 1},"${b.name}","${b.category}",${b.nickname},${b.distance.toFixed(2)},${b.speed || 0},${b.active ? 'Ativo' : 'Inativo'},"${splitsInfo}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=resultados_volta_ao_lago.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar logs de trechos de um barco
app.get('/api/boats/:id/splits', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM exchange_logs WHERE boat_id = $1 ORDER BY exchange_index ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ativar/Desativar SOS
app.post('/api/boats/:id/sos', async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  try {
    const result = await pool.query('UPDATE boats SET sos_active = $1 WHERE id = $2 RETURNING *', [active, id]);
    io.emit('boat_updated', result.rows[0]);
    if (active) io.emit('sos_alert', { boatName: result.rows[0].name, boatId: id });
    res.json(result.rows[0]);
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
      
      // Calcular distância se já tinha posição anterior
      if (oldLat && oldLng) {
        const distKm = getDistance(oldLat, oldLng, lat, lng);
        if (distKm > 0.005 && distKm < 2.0) {
          distance += distKm;
        }
      }
      
      const currentSpeed = speed ? (speed * 3.6).toFixed(1) : 0; // Convert m/s to km/h
      
      await pool.query(
        'UPDATE boats SET lat = $1, lng = $2, distance = $3, speed = $4, heading = $5, battery_level = $6, last_updated = CURRENT_TIMESTAMP WHERE id = $7',
        [lat, lng, distance, currentSpeed, heading || 0, batteryLevel || 100, boatId]
      );

      // Salvar no histórico para o rastro
      await pool.query(
        'INSERT INTO location_history (boat_id, lat, lng) VALUES ($1, $2, $3)',
        [boatId, lat, lng]
      );
      
      io.emit('location_changed', { boatId, lat, lng, distance, speed: currentSpeed, heading: heading || 0, batteryLevel, lastUpdated: new Date() });
    } catch (err) {
      console.error('Erro Socket:', err.message);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
