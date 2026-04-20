import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Anchor, Map as MapIcon, Settings, Play, Square, Battery, RefreshCw } from 'lucide-react';

// --- CONFIGURAÇÕES ---
// Substitua pela URL do seu Backend no Render (ex: https://voltaaolago-server.onrender.com)
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001' 
  : 'https://voltaaolago-server.onrender.com';

const socket = io(API_URL);

// Ícone personalizado para os barcos
const boatIcon = (type) => L.divIcon({
  html: `<div style="background-color: white; border-radius: 50%; padding: 5px; border: 2px solid #2563eb; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10a6 6 0 0 1-10.5 3.84L7 10l-4 3.84a6 6 0 1 1-1.5-11.34A6 6 0 0 1 12 4.16 6 6 0 0 1 22 10Z"/>
          </svg>
         </div>`,
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

// Componente para centralizar o mapa automaticamente
function AutoCenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, 14);
  }, [center]);
  return null;
}

// --- APP PRINCIPAL ---
export default function App() {
  const [view, setView] = useState('map'); // 'map', 'track', 'admin'
  const [boats, setBoats] = useState([]);
  const [selectedBoatId, setSelectedBoatId] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const [battery, setBattery] = useState(null);
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  // Carregar barcos iniciais
  useEffect(() => {
    fetchBoats();
    
    // Ouvir atualizações em tempo real
    socket.on('location_changed', (data) => {
      setBoats(prev => prev.map(b => 
        b.id === data.boatId 
          ? { ...b, lat: data.lat, lng: data.lng, battery: data.battery, last_updated: data.lastUpdated } 
          : b
      ));
    });

    return () => socket.off('location_changed');
  }, []);

  const fetchBoats = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/boats`);
      setBoats(res.data);
    } catch (err) {
      console.error('Erro ao buscar barcos:', err);
    }
  };

  // --- LÓGICA DE RASTREAMENTO ---

  const startTracking = async () => {
    if (!selectedBoatId) return alert('Selecione um barco primeiro!');

    try {
      // 1. Solicitar Wake Lock (Manter CPU ativa)
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('Wake Lock ativo!');
      }

      // 2. Play Silent Audio (Truque para iOS não suspender a aba)
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true;
      audio.play();
      audioRef.current = audio;

      // 3. Iniciar Ciclo de GPS
      setIsTracking(true);
      trackLocation();
    } catch (err) {
      console.error('Falha ao iniciar rádio:', err);
      alert('Erro ao iniciar rastreamento. Certifique-se de estar em HTTPS.');
    }
  };

  const stopTracking = () => {
    setIsTracking(false);
    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    window.location.reload(); // Simples reset
  };

  const trackLocation = () => {
    if (!navigator.geolocation) return alert('GPS não suportado');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLastPos({ lat: latitude, lng: longitude });

        // Tentar pegar bateria
        if (navigator.getBattery) {
          const bat = await navigator.getBattery();
          setBattery(Math.round(bat.level * 100));
        }

        socket.emit('update_location', {
          boatId: selectedBoatId,
          lat: latitude,
          lng: longitude,
          battery: battery
        });

        // Agendar próxima leitura (1 minuto para economia de bateria)
        if (isTracking) setTimeout(trackLocation, 60000);
      },
      (err) => console.error(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  // --- RENDERIZAÇÃO ---

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      {/* NAVBAR */}
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '10px', display: 'flex', justifyContent: 'space-around' }}>
        <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={20} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={20} /> Transmitir</button>
        <button onClick={() => setView('admin')} style={navBtnStyle}><Settings size={20} /> Admin</button>
      </nav>

      {/* CONTEÚDO */}
      <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
        
        {view === 'map' && (
          <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {boats.map(boat => boat.lat && (
              <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.type)}>
                <Popup>
                  <strong>{boat.name}</strong><br/>
                  Tipo: {boat.type}<br/>
                  🔋 Bateria: {boat.battery || '?'}%<br/>
                  🕒 {new Date(boat.last_updated).toLocaleTimeString()}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}

        {view === 'track' && (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <Anchor size={48} color="#1e3a8a" />
            <h2>Rastreador do Barco</h2>
            <p>Selecione seu barco na lista abaixo para começar a transmitir a localização para o mapa público.</p>
            
            {!isTracking ? (
              <>
                <select 
                  style={inputStyle} 
                  onChange={(e) => setSelectedBoatId(parseInt(e.target.value))}
                  defaultValue=""
                >
                  <option value="" disabled>Selecione o Barco...</option>
                  {boats.map(b => <option key={b.id} value={b.id}>{b.name} ({b.type})</option>)}
                </select>
                <button onClick={startTracking} style={startBtnStyle}>INICIAR TRANSMISSÃO</button>
              </>
            ) : (
              <div style={activeTrackStyle}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#059669' }}>RASTREAMENTO ATIVO</div>
                <div style={{ margin: '20px 0' }}>
                  <p><RefreshCw size={16} /> Última: {new Date().toLocaleTimeString()}</p>
                  <p><Battery size={16} /> Bateria: {battery}%</p>
                  <p>Lat: {lastPos?.lat.toFixed(5)} | Lng: {lastPos?.lng.toFixed(5)}</p>
                </div>
                <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '8px', fontSize: '14px' }}>
                  ⚠️ Mantenha esta página aberta e visível. Brilho no mínimo para economizar bateria.
                </div>
                <button onClick={stopTracking} style={stopBtnStyle}>PARAR TRANSMISSÃO</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <AdminPanel fetchBoats={fetchBoats} boats={boats} />
        )}

      </div>
    </div>
  );
}

function AdminPanel({ fetchBoats, boats }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('OC6');

  const createBoat = async () => {
    if (!name) return;
    await axios.post(`${API_URL}/api/boats`, { name, type });
    setName('');
    fetchBoats();
  };

  return (
    <div style={{ padding: '20px' }}>
      <h3>Novo Barco</h3>
      <input 
        placeholder="Nome do Barco (ex: Canoa 01)" 
        value={name} 
        onChange={e => setName(e.target.value)} 
        style={inputStyle}
      />
      <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
        <option value="OC6">OC6</option>
        <option value="OC1">OC1</option>
        <option value="V1">V1</option>
        <option value="Surfski">Surfski</option>
        <option value="Remo Olímpico">Remo Olímpico</option>
      </select>
      <button onClick={createBoat} style={startBtnStyle}>CRIAR BARCO</button>

      <h3 style={{ marginTop: '30px' }}>Barcos Existentes</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {boats.map(b => (
          <li key={b.id} style={{ borderBottom: '1px solid #ddd', padding: '10px 0' }}>
            {b.name} ({b.type}) - ID: {b.id}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- ESTILOS ---
const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '12px', cursor: 'pointer' };
const inputStyle = { width: '100%', padding: '12px', margin: '10px 0', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px' };
const startBtnStyle = { width: '100%', padding: '15px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' };
const stopBtnStyle = { width: '100%', padding: '15px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' };
const activeTrackStyle = { border: '2px solid #059669', padding: '20px', borderRadius: '15px', background: '#f0fdf4', marginTop: '20px' };
