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

// Credenciais Secretas via URL
const ADMIN_PATH = '/admin/admin:lago2026';

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

const boatIcon = (type, status = 'online') => {
  const colors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const color = colors[status] || colors.online;
  return L.divIcon({
    html: `<div style="background-color: ${color}; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); transition: all 0.5s ease;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
            </svg>
           </div>`,
    className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20]
  });
};

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
  const [boatName, setBoatName] = useState('');
  const [category, setCategory] = useState('');
  const [boatType, setBoatType] = useState('');
  const [crewInput, setCrewInput] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Controle Dinâmico de Intervalo de GPS
  const [relayTimeout, setRelayTimeout] = useState(1);
  const relayTimeoutRef = useRef(1);

  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  // Detectar Admin via Query Params (?u=admin&p=lago2026)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('u') === 'admin' && params.get('p') === 'lago2026') {
      setView('admin');
      // Limpa a URL para não ficar expondo a senha na barra de endereço
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    const fetchTimer = setInterval(() => fetchBoats(), 60000); // Polling agressivo de fallback
    return () => {
      clearInterval(timer);
      clearInterval(fetchTimer);
    };
  }, []);

  useEffect(() => {
    fetchBoats();
    
    socket.on('config_updated', (data) => {
      setRelayTimeout(data.relayTimeout);
      relayTimeoutRef.current = data.relayTimeout;
    });

    socket.on('location_changed', (data) => {
      setBoats(prev => {
        if (!prev.find(b => b.id === data.boatId)) {
          fetchBoats(); // Se receber localização de barco novo, recarrega a lista
          return prev;
        }
        return prev.map(b => b.id === data.boatId ? { ...b, ...data, last_updated: data.lastUpdated } : b);
      });
    });

    socket.on('boat_updated', (updatedBoat) => {
      setBoats(prev => {
        if (prev.find(b => b.id === updatedBoat.id)) {
          return prev.map(b => b.id === updatedBoat.id ? { ...b, ...updatedBoat } : b);
        }
        return [...prev, updatedBoat]; // Adiciona barco novo se não existir
      });
    });

    socket.on('boat_deleted', (data) => {
      setBoats(prev => prev.filter(b => b.id !== data.id));
      if (selectedMapBoatId === data.id) setSelectedMapBoatId(null);
    });

    socket.on('control_taken', (data) => {
      if (isTracking && trackingBoatId === data.boatId) {
        alert("⚠️ Outra equipe assumiu o controle deste barco!");
        stopTracking(true);
      }
    });

    return () => {
      socket.off('config_updated');
      socket.off('location_changed'); 
      socket.off('boat_updated'); 
      socket.off('boat_deleted');
      socket.off('control_taken');
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
    if (!boatName || !boatType || !crewInput) return alert('Preencha todos os campos!');
    try {
      const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType, current_crew: crewInput.split(',').map(s => s.trim()) });
      await activateHardwareGPS(res.data.id);
    } catch (err) { alert('Erro ao criar barco.'); }
  };

  const joinQueue = async (id) => {
    if (!crewInput) return alert('Digite os nomes!');
    try {
      await axios.post(`${API_URL}/api/boats/${id}/queue`, { crew: crewInput.split(',').map(s => s.trim()) });
      alert('Entrou na fila!'); setCrewInput('');
    } catch (err) { alert('Erro na fila.'); }
  };

  const takeControl = async (id) => {
    if (!crewInput) return alert('Digite seus nomes antes de assumir!');
    try {
      await axios.post(`${API_URL}/api/boats/${id}/take_control`, { new_crew: crewInput.split(',').map(s => s.trim()) });
      await activateHardwareGPS(id);
    } catch (err) { alert('Erro ao assumir controle.'); }
  };

  const deleteBoat = async (id) => {
    if (window.confirm('Tem certeza que deseja remover este barco completamente?')) {
      try {
        await axios.delete(`${API_URL}/api/boats/${id}`);
      } catch (err) { alert('Erro ao remover barco.'); }
    }
  };

  const removeFromQueue = async (boatId, index) => {
    if (window.confirm('Remover esta equipe da fila?')) {
      try {
        await axios.delete(`${API_URL}/api/boats/${boatId}/queue/${index}`);
      } catch (err) { alert('Erro ao remover da fila.'); }
    }
  };

  const activateHardwareGPS = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio;
      setTrackingBoatId(id); setIsTracking(true); trackLocation(id);
    } catch (err) { alert('Erro GPS. Use HTTPS.'); }
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

  const visibleBoats = boats.filter(b => {
    if (!b.last_updated) return true;
    const diff = (currentTime - new Date(b.last_updated).getTime()) / 3600000;
    return diff < 1;
  });

  const mapSelectedBoat = boats.find(b => b.id === selectedMapBoatId);
  const trackFoundBoat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={22} /> Transmitir</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {view === 'map' && (
          <>
            <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', transition: 'all 0.3s ease' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapAutoZoom boats={visibleBoats} selectedMapBoatId={selectedMapBoatId} />
                {visibleBoats.map(boat => boat.lat && (
                  <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.type, getBoatStatus(boat.last_updated))} eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }}>
                    {!selectedMapBoatId && <Popup><div style={{ fontWeight: 'bold' }}>{boat.name}</div></Popup>}
                  </Marker>
                ))}
              </MapContainer>
            </div>
            {selectedMapBoatId && mapSelectedBoat && (
              <div style={{ flex: '1 1 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h2 style={{ margin: 0, fontSize: '22px' }}>{mapSelectedBoat.name}</h2>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{mapSelectedBoat.type}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                  <div style={infoCardStyle}><Navigation size={16} color="#059669" /><div><span style={infoLabel}>Distância</span><br/><strong>{mapSelectedBoat.distance?.toFixed(2) || 0} km</strong></div></div>
                  <div style={infoCardStyle}><Activity size={16} color="#2563eb" /><div><span style={infoLabel}>Sinal</span><br/><strong>{new Date(mapSelectedBoat.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></div></div>
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '8px' }}><Users size={18} /> Tripulação Atual</div>
                  <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '10px' }}>{mapSelectedBoat.current_crew?.join(', ') || 'Ninguém'}</div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '8px' }}><RefreshCw size={18} /> Próximas Trocas</div>
                  {mapSelectedBoat.crew_queue?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {mapSelectedBoat.crew_queue.map((q, i) => <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px' }}><strong>#{i+1}</strong> {q.join(', ')}</div>)}
                    </div>
                  ) : <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>Nenhuma equipe aguardando.</div>}
                </div>
                <button onClick={() => { setView('track'); setBoatName(mapSelectedBoat.name); }} style={{ ...startBtnStyle, marginTop: '25px', background: '#0f172a' }}>Gerenciar Barco</button>
              </div>
            )}
          </>
        )}

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
                    <button onClick={() => joinQueue(trackFoundBoat.id)} style={{ ...startBtnStyle, background: '#475569', marginTop: '10px' }}>Entrar na Fila</button>
                    <button onClick={() => takeControl(trackFoundBoat.id)} style={{ ...startBtnStyle, marginTop: '10px' }}>Assumir Controle</button>
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
                <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '12px', fontSize: '12px', color: '#92400e', marginBottom: '20px' }}>
                  Intervalo atual: {relayTimeout} min
                </div>
                <button onClick={() => stopTracking()} style={stopBtnStyle}>Encerrar</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Modo Administrador</h2>
                <button onClick={() => setView('map')} style={{ background: '#475569', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px' }}>Sair</button>
              </div>
              
              <div style={{ background: '#fff', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Intervalo de GPS (Global)</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Aplica-se a todos os barcos em tempo real</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <select 
                    value={relayTimeout} 
                    onChange={(e) => axios.post(`${API_URL}/api/config`, { relayTimeout: e.target.value })}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 'bold' }}
                  >
                    {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} min</option>)}
                  </select>
                </div>
              </div>
            </div>

            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '15px', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{b.name}</div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>{b.distance?.toFixed(2) || 0} km | {b.type}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ color: getBoatStatus(b.last_updated) === 'online' ? '#059669' : '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}>{getBoatStatus(b.last_updated).toUpperCase()}</div>
                    <button onClick={() => deleteBoat(b.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '5px' }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                {b.crew_queue && b.crew_queue.length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748b', marginBottom: '5px' }}>Fila de Troca:</div>
                    {b.crew_queue.map((q, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', padding: '5px 0' }}>
                        <span>#{i+1} {q.join(', ')}</span>
                        <button onClick={() => removeFromQueue(b.id, i)} style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer' }}>
                          <UserMinus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.7; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px', cursor: 'pointer', gap: '4px' };
const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '5px' };
const inputStyle = { width: '100%', padding: '14px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '15px' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const stopBtnStyle = { width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold' };
const activeTrackStyle = { border: '3px solid #10b981', padding: '40px 20px', borderRadius: '25px', background: '#ecfdf5', textAlign: 'center' };
const infoCardStyle = { display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '10px', fontSize: '14px', border: '1px solid #e2e8f0' };
const infoLabel = { fontSize: '11px', color: '#64748b', textTransform: 'uppercase' };
