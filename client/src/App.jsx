import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Settings, Play, Battery, RefreshCw, Ship, Anchor } from 'lucide-react';

// --- CONFIGURAÇÕES ---
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

// Ícone do Barco - Redesenhado para evitar clipping
const boatIcon = (type) => L.divIcon({
  html: `<div style="
          background-color: #2563eb; 
          border-radius: 50%; 
          width: 40px; 
          height: 40px; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          border: 3px solid white; 
          box-shadow: 0 4px 10px rgba(0,0,0,0.4);
          transform: rotate(0deg);
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
          </svg>
         </div>`,
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20]
});

function MapAutoZoom({ boats }) {
  const map = useMap();
  useEffect(() => {
    const activeBoats = boats.filter(b => b.lat && b.lng);
    if (activeBoats.length > 0) {
      const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  }, [boats, map]);
  return null;
}

export default function App() {
  const [view, setView] = useState('map');
  const [boats, setBoats] = useState([]);
  const [boatName, setBoatName] = useState('');
  const [category, setCategory] = useState('');
  const [boatType, setBoatType] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const [battery, setBattery] = useState(null);
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    fetchBoats();
    socket.on('location_changed', (data) => {
      setBoats(prev => {
        const exists = prev.find(b => b.id === data.boatId);
        if (exists) {
          return prev.map(b => b.id === data.boatId ? { ...b, ...data, last_updated: data.lastUpdated } : b);
        } else {
          fetchBoats();
          return prev;
        }
      });
    });
    return () => socket.off('location_changed');
  }, []);

  const fetchBoats = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/boats`);
      setBoats(res.data);
    } catch (err) { console.error('Erro API:', err); }
  };

  const startTracking = async () => {
    if (!boatName || !boatType) return alert('Identifique o barco!');
    try {
      let boat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());
      if (!boat) {
        const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType });
        boat = res.data;
      }
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio;
      setIsTracking(true);
      trackLocation(boat.id);
    } catch (err) { alert('Erro ao iniciar GPS. Use HTTPS.'); }
  };

  const trackLocation = (id) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLastPos({ lat: latitude, lng: longitude });
        
        let batLevel = null;
        try { 
          if (navigator.getBattery) { 
            const bat = await navigator.getBattery(); 
            batLevel = Math.round(bat.level * 100);
            setBattery(batLevel); 
          } 
        } catch(e) {}

        socket.emit('update_location', { boatId: id, lat: latitude, lng: longitude, battery: batLevel });
        if (isTracking) setTimeout(() => trackLocation(id), 60000);
      },
      (err) => { if (isTracking) setTimeout(() => trackLocation(id), 15000); },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={22} /> Transmitir</button>
        <button onClick={() => setView('admin')} style={navBtnStyle}><Settings size={22} /> Admin</button>
      </nav>

      <div style={{ flex: 1, position: 'relative' }}>
        {view === 'map' && (
          <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapAutoZoom boats={boats} />
            {boats.map(boat => boat.lat && (
              <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.type)}>
                <Popup>
                  <div style={{ textAlign: 'center', minWidth: '120px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>{boat.name}</div>
                    <div style={{ color: '#64748b', fontSize: '13px', marginBottom: '8px' }}>{boat.type}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '12px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                      {boat.battery && <span><Battery size={14} style={{ verticalAlign: 'middle' }} /> {boat.battery}%</span>}
                      <span><RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> {new Date(boat.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}

        {view === 'track' && (
          <div style={{ padding: '30px 20px', textAlign: 'center', maxWidth: '450px', margin: '0 auto' }}>
            {!isTracking ? (
              <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
                <Anchor size={48} color="#1e3a8a" style={{ marginBottom: '15px' }} />
                <h2 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>Rastrear Barco</h2>
                <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '14px' }}>Identifique-se para aparecer no mapa público.</p>
                
                <input placeholder="Nome do Barco (ex: Canoa 05)" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                
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
                
                <button onClick={startTracking} style={startBtnStyle}>ATIVAR GPS AGORA</button>
              </div>
            ) : (
              <div style={activeTrackStyle}>
                <div style={{ animation: 'pulse 2s infinite' }}>📡</div>
                <h2 style={{ color: '#059669', margin: '10px 0' }}>SINAL ATIVO</h2>
                <p style={{ fontSize: '18px', margin: '5px 0' }}><strong>{boatName}</strong></p>
                <p style={{ color: '#64748b' }}>{boatType}</p>
                
                <div style={{ margin: '25px 0', padding: '15px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', fontSize: '14px' }}>
                  Último sinal: {new Date().toLocaleTimeString()}<br/>
                  {battery && `Bateria: ${battery}%`}
                </div>

                <button onClick={() => window.location.reload()} style={stopBtnStyle}>DESATIVAR GPS</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: '#1e293b' }}>Status da Frota</h3>
            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '10px', padding: '15px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{b.name}</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>{b.type}</div>
                </div>
                <div style={{ color: b.lat ? '#059669' : '#cbd5e1', fontSize: '13px', fontWeight: 'bold' }}>
                  {b.lat ? '● ONLINE' : '○ OFFLINE'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px', cursor: 'pointer', gap: '4px' };
const inputStyle = { width: '100%', padding: '15px', margin: '8px 0', borderRadius: '12px', border: '1px solid #e2e8f0', boxSizing: 'border-box', fontSize: '16px', outline: 'none' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer', fontSize: '16px' };
const stopBtnStyle = { width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' };
const activeTrackStyle = { border: '2px solid #10b981', padding: '30px 20px', borderRadius: '25px', background: '#ecfdf5', textAlign: 'center' };
