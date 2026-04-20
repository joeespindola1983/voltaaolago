import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle, Trash2, UserMinus, Layers } from 'lucide-react';

// --- CONFIGURAÇÕES ---
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

// Ícones dinâmicos
const boatIcon = (type, status = 'online') => {
  const colors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const color = colors[status] || colors.online;
  return L.divIcon({
    html: `<div style="background-color: ${color}; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); transition: all 0.3s ease;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
            </svg>
           </div>`,
    className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20]
  });
};

const clusterIcon = (count) => L.divIcon({
  html: `<div style="background-color: #1e3a8a; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: white; fontWeight: bold; font-size: 16px;">
          ${count}
         </div>`,
  className: '', iconSize: [44, 44], iconAnchor: [22, 22]
});

function MapAutoZoom({ boats, selectedMapBoatId }) {
  const map = useMap();
  useEffect(() => {
    if (selectedMapBoatId) {
      const b = boats.find(x => x.id === selectedMapBoatId);
      if (b && b.lat && b.lng) {
        map.setView([b.lat, b.lng], 16, { animate: true });
        return;
      }
    }
    const activeBoats = boats.filter(b => b.lat && b.lng);
    if (activeBoats.length > 0 && !selectedMapBoatId) {
      const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  }, [boats, map, selectedMapBoatId]);
  return null;
}

export default function App() {
  const [view, setView] = useState('map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [expandedClusterId, setExpandedClusterId] = useState(null); // ID do barco "âncora" do grupo
  
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
      setView('admin');
      window.history.replaceState({}, document.title, "/");
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
      setRelayTimeout(data.relayTimeout);
      relayTimeoutRef.current = data.relayTimeout;
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

  const removeFromQueue = async (boatId, index) => {
    if (window.confirm('Remover da fila?')) {
      try { await axios.delete(`${API_URL}/api/boats/${boatId}/queue/${index}`); } catch (err) { alert('Erro.'); }
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

  // --- LÓGICA DE CLUSTERING ---
  const getVisibleBoatsWithClustering = () => {
    const active = boats.filter(b => b.lat && b.lng && (currentTime - new Date(b.last_updated).getTime()) < 3600000);
    const groups = [];
    const processedIds = new Set();

    active.forEach(b => {
      if (processedIds.has(b.id)) return;
      
      // Procura barcos muito próximos (aprox 20m)
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

  const mapSelectedBoat = boats.find(b => b.id === selectedMapBoatId);
  const trackFoundBoat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); setExpandedClusterId(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={22} /> Transmitir</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {view === 'map' && (
          <>
            <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', transition: 'all 0.3s ease' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} />
                
                {getVisibleBoatsWithClustering().map(group => {
                  const { anchor, members } = group;
                  
                  // Caso 1: Apenas 1 barco ou Grupo Expandido
                  if (members.length === 1 || expandedClusterId === anchor.id) {
                    return members.map((boat, index) => {
                      // Se expandido, aplica um offset lateral (linha)
                      const lat = expandedClusterId === anchor.id ? boat.lat : boat.lat;
                      const lng = expandedClusterId === anchor.id ? boat.lng + (index * 0.0004) : boat.lng;
                      
                      return (
                        <Marker 
                          key={boat.id} 
                          position={[lat, lng]} 
                          icon={boatIcon(boat.type, getBoatStatus(boat.last_updated))}
                          eventHandlers={{ click: () => { setSelectedMapBoatId(boat.id); setExpandedClusterId(null); } }}
                        >
                          {!selectedMapBoatId && <Popup><strong>{boat.name}</strong></Popup>}
                        </Marker>
                      );
                    });
                  }

                  // Caso 2: Grupo Recolhido (Cluster)
                  return (
                    <Marker 
                      key={`cluster-${anchor.id}`}
                      position={[anchor.lat, anchor.lng]}
                      icon={clusterIcon(members.length)}
                      eventHandlers={{ click: () => setExpandedClusterId(anchor.id) }}
                    />
                  );
                })}
              </MapContainer>
            </div>
            
            {selectedMapBoatId && mapSelectedBoat && (
              <div style={{ flex: '1 1 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '20px' }}>{mapSelectedBoat.name}</h2>
                  <button onClick={() => setSelectedMapBoatId(null)} style={{ background: '#f1f5f9', border: 'none', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }}>Fechar</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                  <div style={infoCardStyle}><Navigation size={14} color="#059669" /><div><span style={infoLabel}>KM Est.</span><br/><strong>{mapSelectedBoat.distance?.toFixed(2) || 0}</strong></div></div>
                  <div style={infoCardStyle}><Activity size={14} color="#2563eb" /><div><span style={infoLabel}>Sinal</span><br/><strong>{new Date(mapSelectedBoat.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></div></div>
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <div style={sectionTitleStyle}><Users size={16} /> Tripulação Atual</div>
                  <div style={crewBoxStyle}>{mapSelectedBoat.current_crew?.join(', ') || 'Ninguém'}</div>
                </div>
                <div>
                  <div style={sectionTitleStyle}><RefreshCw size={16} /> Próximas Trocas</div>
                  {mapSelectedBoat.crew_queue?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {mapSelectedBoat.crew_queue.map((q, i) => <div key={i} style={queueItemStyle}><strong>#{i+1}</strong> {q.join(', ')}</div>)}
                    </div>
                  ) : <div style={{ color: '#94a3b8', fontSize: '13px' }}>Sem trocas pendentes.</div>}
                </div>
              </div>
            )}
          </>
        )}

        {/* ... (restante do código: view track e admin permanecem iguais) */}
        {view === 'track' && (
          <div style={{ padding: '30px 20px', overflowY: 'auto', width: '100%', boxSizing: 'border-box' }}>
            {!isTracking ? (
              <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', maxWidth: '500px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Anchor size={40} color="#1e3a8a" />
                  {boatName && <button onClick={() => setBoatName('')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#475569', fontSize: '12px' }}>Limpar</button>}
                </div>
                <h2 style={{ margin: '10px 0 5px 0' }}>Rastreador GPS</h2>
                <input placeholder="Nome do Barco" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                {trackFoundBoat ? (
                  <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '15px', textAlign: 'left' }}>
                    <div style={{ color: '#059669', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>✓ {trackFoundBoat.type}</div>
                    <label style={labelStyle}>Sua Equipe (Nomes)</label>
                    <input placeholder="Ex: João, Maria" value={crewInput} onChange={e => setCrewInput(e.target.value)} style={inputStyle} />
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={() => axios.post(`${API_URL}/api/boats/${trackFoundBoat.id}/queue`, { crew: crewInput.split(',').map(s => s.trim()) }).then(() => alert('Fila!'))} style={{ ...startBtnStyle, background: '#475569', flex: 1 }}>Fila</button>
                      <button onClick={() => axios.post(`${API_URL}/api/boats/${trackFoundBoat.id}/take_control`, { new_crew: crewInput.split(',').map(s => s.trim()) }).then(() => activateHardwareGPS(trackFoundBoat.id))} style={{ ...startBtnStyle, flex: 1 }}>Assumir</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: '15px', textAlign: 'left' }}>
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
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Sua Equipe (Nomes)</label>
                    <input placeholder="Ex: João, Maria" value={crewInput} onChange={e => setCrewInput(e.target.value)} style={inputStyle} />
                    <button onClick={startNewTracking} style={startBtnStyle}>Criar e Iniciar</button>
                  </div>
                )}
              </div>
            ) : (
              <div style={activeTrackStyle}>
                <div style={{ animation: 'pulse 2s infinite', fontSize: '40px' }}>📡</div>
                <h2 style={{ color: '#059669' }}>TRANSMITINDO</h2>
                <p><strong>{boatName}</strong></p>
                <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '12px', fontSize: '12px', color: '#92400e', marginBottom: '20px' }}>Intervalo: {relayTimeout} min</div>
                <button onClick={() => stopTracking()} style={stopBtnStyle}>Encerrar</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Admin</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={relayTimeout} onChange={(e) => axios.post(`${API_URL}/api/config`, { relayTimeout: e.target.value })} style={{ padding: '5px', borderRadius: '5px' }}>
                  {[1,2,3,4,5,10].map(n => <option key={n} value={n}>{n} min</option>)}
                </select>
                <button onClick={() => setView('map')} style={{ background: '#475569', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px' }}>Sair</button>
              </div>
            </div>
            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '10px', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div><strong>{b.name}</strong><br/><span style={{ fontSize: '12px', color: '#64748b' }}>{b.distance?.toFixed(2)} km</span></div>
                  <button onClick={() => deleteBoat(b.id)} style={{ color: '#ef4444', border: 'none', background: 'none' }}><Trash2 size={18} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px', cursor: 'pointer', gap: '4px' };
const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '5px' };
const inputStyle = { width: '100%', padding: '14px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '15px' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const stopBtnStyle = { width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const activeTrackStyle = { border: '3px solid #10b981', padding: '40px 20px', borderRadius: '25px', background: '#ecfdf5', textAlign: 'center' };
const infoCardStyle = { display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '10px', borderRadius: '10px', fontSize: '13px', border: '1px solid #e2e8f0' };
const infoLabel = { fontSize: '10px', color: '#64748b', textTransform: 'uppercase' };
const sectionTitleStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' };
const crewBoxStyle = { background: '#f1f5f9', padding: '10px', borderRadius: '8px', fontSize: '14px' };
const queueItemStyle = { background: '#fff', border: '1px solid #e2e8f0', padding: '8px', borderRadius: '8px', fontSize: '13px' };
