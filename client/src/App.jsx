import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle, Trash2, UserMinus } from 'lucide-react';

// --- CONFIGURAÇÕES ---
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

const boatIcon = (type, status = 'online', isMe = false) => {
  const colors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const color = isMe ? '#10b981' : (colors[status] || colors.online); // Verde se for o meu barco
  return L.divIcon({
    html: `<div style="background-color: ${color}; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); transition: all 0.5s ease; ${isMe ? 'outline: 4px solid rgba(16,185,129,0.3);' : ''}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
            </svg>
           </div>`,
    className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20]
  });
};

const clusterIcon = (count) => L.divIcon({
  html: `<div style="background-color: #1e3a8a; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: white; fontWeight: bold; font-size: 16px;">${count}</div>`,
  className: '', iconSize: [44, 44], iconAnchor: [22, 22]
});

function MapAutoZoom({ boats, selectedMapBoatId, focusBoatId }) {
  const map = useMap();
  useEffect(() => {
    const focusId = focusBoatId || selectedMapBoatId;
    if (focusId) {
      const b = boats.find(x => x.id === focusId);
      if (b && b.lat && b.lng) {
        map.setView([b.lat, b.lng], 16, { animate: true });
        return;
      }
    }
    const activeBoats = boats.filter(b => b.lat && b.lng);
    if (activeBoats.length > 0 && !focusId) {
      const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  }, [boats, map, selectedMapBoatId, focusBoatId]);
  return null;
}

export default function App() {
  const [view, setView] = useState('map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [expandedClusterId, setExpandedClusterId] = useState(null);
  
  const [boatName, setBoatName] = useState('');
  const [category, setCategory] = useState('');
  const [boatType, setBoatType] = useState('');
  const [crewInput, setCrewInput] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [relayTimeout, setRelayTimeout] = useState(1);
  const relayTimeoutRef = useRef(1);

  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('u') === 'admin' && params.get('p') === 'lago2026') {
      setView('admin'); window.history.replaceState({}, document.title, "/");
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    const fetchTimer = setInterval(() => fetchBoats(), 60000);
    return () => { clearInterval(timer); clearInterval(fetchTimer); };
  }, []);

  useEffect(() => {
    fetchBoats();
    socket.on('config_updated', (data) => {
      setRelayTimeout(data.relayTimeout); relayTimeoutRef.current = data.relayTimeout;
    });
    socket.on('location_changed', (data) => {
      setBoats(prev => {
        if (!prev.find(b => b.id === data.boatId)) { fetchBoats(); return prev; }
        return prev.map(b => b.id === data.boatId ? { ...b, ...data, last_updated: data.lastUpdated } : b);
      });
    });
    socket.on('boat_updated', (updatedBoat) => {
      setBoats(prev => {
        if (prev.find(b => b.id === updatedBoat.id)) return prev.map(b => b.id === updatedBoat.id ? { ...b, ...updatedBoat } : b);
        return [...prev, updatedBoat];
      });
    });
    socket.on('boat_deleted', (data) => {
      setBoats(prev => prev.filter(b => b.id !== data.id));
      if (selectedMapBoatId === data.id) setSelectedMapBoatId(null);
      if (trackingBoatId === data.id) stopTracking();
    });
    socket.on('control_taken', (data) => {
      if (isTracking && trackingBoatId === data.boatId) {
        alert("⚠️ Controle assumido por outra equipe!"); stopTracking(true);
      }
    });
    return () => {
      socket.off('config_updated'); socket.off('location_changed'); socket.off('boat_updated'); socket.off('boat_deleted'); socket.off('control_taken');
    };
  }, [isTracking, trackingBoatId, selectedMapBoatId]);

  const fetchBoats = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/boats`);
      setBoats(res.data);
    } catch (err) { console.error('Erro API:', err); }
  };

  const getBoatStatus = (lastUpdated) => {
    if (!lastUpdated) return 'lost';
    const diff = (currentTime - new Date(lastUpdated).getTime()) / 60000;
    if (diff < 5) return 'online';
    if (diff < 10) return 'warning';
    return 'lost';
  };

  const startNewTracking = async () => {
    if (!boatName || !boatType || !crewInput) return alert('Preencha tudo!');
    try {
      const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType, current_crew: crewInput.split(',').map(s => s.trim()) });
      await activateHardwareGPS(res.data.id);
    } catch (err) { alert('Erro ao criar.'); }
  };

  const deleteBoat = async (id) => {
    if (window.confirm('Remover barco?')) {
      try { await axios.delete(`${API_URL}/api/boats/${id}`); } catch (err) { alert('Erro.'); }
    }
  };

  const activateHardwareGPS = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio;
      setTrackingBoatId(id); setIsTracking(true); trackLocation(id);
    } catch (err) { alert('Erro GPS.'); }
  };

  const stopTracking = (forceMap = false) => {
    setIsTracking(false); setTrackingBoatId(null);
    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    if (forceMap) setView('map'); else window.location.reload();
  };

  const trackLocation = (id) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        socket.emit('update_location', { boatId: id, lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (isTracking) setTimeout(() => trackLocation(id), relayTimeoutRef.current * 60000);
      },
      (err) => { if (isTracking) setTimeout(() => trackLocation(id), 15000); },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  };

  const getVisibleBoatsWithClustering = () => {
    const active = boats.filter(b => b.lat && b.lng && (currentTime - new Date(b.last_updated).getTime()) < 3600000);
    const groups = [];
    const processedIds = new Set();
    active.forEach(b => {
      if (processedIds.has(b.id)) return;
      const near = active.filter(other => {
        if (processedIds.has(other.id)) return false;
        const dist = Math.sqrt(Math.pow(b.lat - other.lat, 2) + Math.pow(b.lng - other.lng, 2));
        return dist < 0.0002; 
      });
      near.forEach(n => processedIds.add(n.id));
      groups.push({ anchor: b, members: near });
    });
    return groups;
  };

  const trackFoundBoat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());

  // Renderizador comum de Mapa para ser usado em ambas as abas
  const renderMap = (focusId = null) => (
    <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={focusId} />
      {getVisibleBoatsWithClustering().map(group => {
        const { anchor, members } = group;
        if (members.length === 1 || expandedClusterId === anchor.id) {
          return members.map((boat, index) => {
            const lngOffset = expandedClusterId === anchor.id ? (index * 0.0004) : 0;
            return (
              <Marker key={boat.id} position={[boat.lat, boat.lng + lngOffset]} icon={boatIcon(boat.type, getBoatStatus(boat.last_updated), boat.id === trackingBoatId)} eventHandlers={{ click: () => { setSelectedMapBoatId(boat.id); setExpandedClusterId(null); if (view !== 'map') setView('map'); } }}>
                <Popup><strong>{boat.name}</strong> {boat.id === trackingBoatId && '(Você)'}</Popup>
              </Marker>
            );
          });
        }
        return (
          <Marker key={`cluster-${anchor.id}`} position={[anchor.lat, anchor.lng]} icon={clusterIcon(members.length)} eventHandlers={{ click: () => setExpandedClusterId(anchor.id) }} />
        );
      })}
    </MapContainer>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); setExpandedClusterId(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={22} /> Transmitir</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {view === 'map' && (
          <>
            <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', transition: 'all 0.3s ease' }}>{renderMap()}</div>
            {selectedMapBoatId && boats.find(b => b.id === selectedMapBoatId) && (
              <div style={{ flex: '1 1 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '20px' }}>{boats.find(b => b.id === selectedMapBoatId).name}</h2>
                  <button onClick={() => setSelectedMapBoatId(null)} style={{ background: '#f1f5f9', border: 'none', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }}>Fechar</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                  <div style={infoCardStyle}><Navigation size={14} color="#059669" /><div><span style={infoLabel}>KM</span><br/><strong>{boats.find(b => b.id === selectedMapBoatId).distance?.toFixed(2) || 0}</strong></div></div>
                  <div style={infoCardStyle}><Activity size={14} color="#2563eb" /><div><span style={infoLabel}>Sinal</span><br/><strong>{new Date(boats.find(b => b.id === selectedMapBoatId).last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></div></div>
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <div style={sectionTitleStyle}><Users size={16} /> Tripulação</div>
                  <div style={crewBoxStyle}>{boats.find(b => b.id === selectedMapBoatId).current_crew?.join(', ') || 'Ninguém'}</div>
                </div>
                <button onClick={() => { setView('track'); setBoatName(boats.find(b => b.id === selectedMapBoatId).name); }} style={{ ...startBtnStyle, marginTop: '10px', background: '#0f172a' }}>Assumir Este Barco</button>
              </div>
            )}
          </>
        )}

        {view === 'track' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {!isTracking ? (
              <div style={{ padding: '30px 20px', overflowY: 'auto' }}>
                <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', maxWidth: '500px', margin: '0 auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><Anchor size={40} color="#1e3a8a" />{boatName && <button onClick={() => setBoatName('')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>Limpar</button>}</div>
                  <h2 style={{ margin: '10px 0 5px 0' }}>Rastreador GPS</h2>
                  <input placeholder="Nome do Barco" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                  {trackFoundBoat ? (
                    <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '15px', textAlign: 'left' }}>
                      <div style={{ color: '#059669', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>✓ {trackFoundBoat.type}</div>
                      <label style={labelStyle}>Sua Equipe</label>
                      <input placeholder="Nomes..." value={crewInput} onChange={e => setCrewInput(e.target.value)} style={inputStyle} />
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={() => axios.post(`${API_URL}/api/boats/${trackFoundBoat.id}/queue`, { crew: crewInput.split(',').map(s => s.trim()) }).then(() => alert('Fila!'))} style={{ ...startBtnStyle, background: '#475569', flex: 1 }}>Fila</button>
                        <button onClick={() => axios.post(`${API_URL}/api/boats/${trackFoundBoat.id}/take_control`, { new_crew: crewInput.split(',').map(s => s.trim()) }).then(() => activateHardwareGPS(trackFoundBoat.id))} style={{ ...startBtnStyle, flex: 1 }}>Assumir</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: '15px', textAlign: 'left' }}>
                      <select style={inputStyle} onChange={(e) => { setCategory(e.target.value); setBoatType(''); }} value={category}><option value="">Categoria...</option>{Object.keys(BOAT_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}</select>
                      {category && <select style={inputStyle} onChange={(e) => setBoatType(e.target.value)} value={boatType}><option value="">Tipo...</option>{BOAT_CATEGORIES[category].map(type => <option key={type} value={type}>{type}</option>)}</select>}
                      <label style={{ ...labelStyle, marginTop: '10px' }}>Sua Equipe</label>
                      <input placeholder="Nomes..." value={crewInput} onChange={e => setCrewInput(e.target.value)} style={inputStyle} />
                      <button onClick={startNewTracking} style={startBtnStyle}>Criar e Iniciar</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: '#ecfdf5', padding: '15px 20px', borderBottom: '2px solid #10b981', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#059669', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}><div style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', animation: 'pulse 2s infinite' }}></div> TRANSMITINDO</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{boatName}</div>
                  </div>
                  <button onClick={() => stopTracking()} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '13px' }}>PARAR</button>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  {renderMap(trackingBoatId)}
                  <div style={{ position: 'absolute', bottom: '20px', left: '20px', right: '20px', background: 'rgba(255,255,255,0.9)', padding: '10px', borderRadius: '12px', zIndex: 1000, boxShadow: '0 4px 15px rgba(0,0,0,0.1)', fontSize: '12px', textAlign: 'center' }}>
                    <strong>Dica:</strong> Mantenha a aba aberta. O mapa abaixo mostra sua posição (ícone verde) e dos outros barcos.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Admin</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={relayTimeout} onChange={(e) => axios.post(`${API_URL}/api/config`, { relayTimeout: e.target.value })} style={{ padding: '5px' }}>{[1,2,3,4,5,10].map(n => <option key={n} value={n}>{n} min</option>)}</select>
                <button onClick={() => setView('map')} style={{ background: '#475569', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px' }}>Sair</button>
              </div>
            </div>
            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '10px', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between' }}>
                <div><strong>{b.name}</strong><br/><span style={{ fontSize: '12px', color: '#64748b' }}>{b.distance?.toFixed(2)} km</span></div>
                <button onClick={() => deleteBoat(b.id)} style={{ color: '#ef4444', border: 'none', background: 'none' }}><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }`}</style>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px', cursor: 'pointer', gap: '4px' };
const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '5px' };
const inputStyle = { width: '100%', padding: '14px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '15px' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const infoCardStyle = { display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '10px', borderRadius: '10px', fontSize: '13px', border: '1px solid #e2e8f0' };
const infoLabel = { fontSize: '10px', color: '#64748b', textTransform: 'uppercase' };
const sectionTitleStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' };
const crewBoxStyle = { background: '#f1f5f9', padding: '10px', borderRadius: '8px', fontSize: '14px' };
