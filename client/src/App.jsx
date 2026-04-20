import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Anchor, Map as MapIcon, Settings, Play, Battery, RefreshCw, Ship } from 'lucide-react';

// --- CONFIGURAÇÕES ---
// Agora ele detecta automaticamente o host para Socket e API
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001' 
  : window.location.origin;

const socket = io(API_URL);

// Definições de tipos de barcos
const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

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

export default function App() {
  const [view, setView] = useState('map');
  const [boats, setBoats] = useState([]);
  
  // Estado para o Rastreador
  const [boatName, setBoatName] = useState('');
  const [category, setCategory] = useState('');
  const [boatType, setBoatType] = useState('');
  const [selectedBoatId, setSelectedBoatId] = useState(null);
  
  const [isTracking, setIsTracking] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const [battery, setBattery] = useState(null);
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    fetchBoats();
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

  const startTracking = async () => {
    if (!boatName || !boatType) return alert('Preencha o nome e tipo do barco!');

    try {
      let boat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());
      if (!boat) {
        const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType });
        boat = res.data;
      }
      setSelectedBoatId(boat.id);
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio;
      setIsTracking(true);
      trackLocation(boat.id);
    } catch (err) {
      alert('Erro ao iniciar. Verifique se está em HTTPS.');
    }
  };

  const trackLocation = (id) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLastPos({ lat: latitude, lng: longitude });
        try { if (navigator.getBattery) { const bat = await navigator.getBattery(); setBattery(Math.round(bat.level * 100)); } } catch(e) {}
        socket.emit('update_location', { boatId: id, lat: latitude, lng: longitude, battery: battery });
        if (isTracking) setTimeout(() => trackLocation(id), 60000);
      },
      (err) => { if (isTracking) setTimeout(() => trackLocation(id), 10000); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '10px', display: 'flex', justifyContent: 'space-around' }}>
        <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={20} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={20} /> Transmitir</button>
        <button onClick={() => setView('admin')} style={navBtnStyle}><Settings size={20} /> Admin</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
        {view === 'map' && (
          <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {boats.map(boat => boat.lat && (
              <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.type)}>
                <Popup>
                  <strong>{boat.name}</strong> ({boat.type})<br/>
                  🔋 {boat.battery || '?'}% | 🕒 {new Date(boat.last_updated).toLocaleTimeString()}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}

        {view === 'track' && (
          <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
            {!isTracking ? (
              <div style={{ textAlign: 'center' }}>
                <Ship size={48} color="#1e3a8a" />
                <h2>Iniciar Transmissão</h2>
                <input placeholder="Nome do Barco" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                <select style={inputStyle} onChange={(e) => { setCategory(e.target.value); setBoatType(''); }} value={category}>
                  <option value="">Categoria...</option>
                  {Object.keys(BOAT_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                {category && (
                  <select style={inputStyle} onChange={(e) => setBoatType(e.target.value)} value={boatType}>
                    <option value="">Tipo...</option>
                    {BOAT_CATEGORIES[category].map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                )}
                <button onClick={startTracking} style={startBtnStyle} disabled={!boatName || !boatType}>COMEÇAR</button>
              </div>
            ) : (
              <div style={activeTrackStyle}>
                <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#059669' }}>📡 TRANSMITINDO</div>
                <p><strong>{boatName}</strong> ({boatType})</p>
                <p>Bateria: {battery || '?'}%</p>
                <button onClick={() => window.location.reload()} style={stopBtnStyle}>PARAR</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px' }}>
            <h3>Barcos Ativos</h3>
            {boats.map(b => (
              <div key={b.id} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                {b.name} ({b.type}) - {b.lat ? 'Ativo' : 'Aguardando'}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px' };
const inputStyle = { width: '100%', padding: '14px', margin: '8px 0', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const stopBtnStyle = { width: '100%', padding: '16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const activeTrackStyle = { border: '2px solid #059669', padding: '20px', borderRadius: '15px', background: '#f0fdf4', textAlign: 'center' };
