import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Settings, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle } from 'lucide-react';

// --- CONFIGURAÇÕES ---
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

// Ícone do Barco com cores dinâmicas baseadas no status do sinal
const boatIcon = (type, status = 'online') => {
  const colors = {
    online: '#2563eb', // Azul
    warning: '#f59e0b', // Amarelo (5-10 min)
    lost: '#64748b'    // Cinza (> 10 min)
  };
  
  const color = colors[status] || colors.online;

  return L.divIcon({
    html: `<div style="background-color: ${color}; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); transition: all 0.5s ease;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
            </svg>
           </div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20]
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
  
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  // Timer para atualizar cores do mapa em tempo real
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchBoats();
    socket.on('location_changed', (data) => {
      setBoats(prev => prev.map(b => b.id === data.boatId ? { ...b, ...data, last_updated: data.lastUpdated } : b));
    });
    socket.on('boat_updated', (updatedBoat) => {
      setBoats(prev => prev.map(b => b.id === updatedBoat.id ? { ...b, ...updatedBoat } : b));
    });
    socket.on('control_taken', (data) => {
      if (isTracking && trackingBoatId === data.boatId) {
        alert("⚠️ Outra equipe assumiu o controle deste barco! Sua transmissão foi encerrada.");
        stopTracking(true);
      }
    });
    return () => {
      socket.off('location_changed');
      socket.off('boat_updated');
      socket.off('control_taken');
    };
  }, [isTracking, trackingBoatId]);

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

  const getCrewArray = () => crewInput.split(',').map(s => s.trim()).filter(s => s);

  const startNewTracking = async () => {
    if (!boatName || !boatType || !crewInput) return alert('Preencha nome, tipo e remadores!');
    try {
      const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType, current_crew: getCrewArray() });
      await activateHardwareGPS(res.data.id);
    } catch (err) { alert('Erro ao criar barco.'); }
  };

  const joinQueue = async (id) => {
    if (!crewInput) return alert('Digite os nomes dos remadores!');
    try {
      await axios.post(`${API_URL}/api/boats/${id}/queue`, { crew: getCrewArray() });
      alert('Fila de troca atualizada!');
      setCrewInput('');
    } catch (err) { alert('Erro ao entrar na fila.'); }
  };

  const takeControl = async (id) => {
    if (!crewInput) return alert('Digite seus nomes antes de assumir!');
    try {
      await axios.post(`${API_URL}/api/boats/${id}/take_control`, { new_crew: getCrewArray() });
      await activateHardwareGPS(id);
    } catch (err) { alert('Erro ao assumir controle.'); }
  };

  const activateHardwareGPS = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio;
      setTrackingBoatId(id);
      setIsTracking(true);
      trackLocation(id);
    } catch (err) { alert('Erro GPS. Use HTTPS.'); }
  };

  const stopTracking = (forceMap = false) => {
    setIsTracking(false);
    setTrackingBoatId(null);
    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    if (forceMap) setView('map');
    else window.location.reload();
  };

  const resetLocalState = () => {
    setBoatName('');
    setCategory('');
    setBoatType('');
    setCrewInput('');
    alert('Identificação limpa. Você pode selecionar outro barco agora.');
  };

  const trackLocation = (id) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        socket.emit('update_location', { boatId: id, lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (isTracking) setTimeout(() => trackLocation(id), 60000);
      },
      (err) => { if (isTracking) setTimeout(() => trackLocation(id), 15000); },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  };

  // Filtrar barcos inativos há mais de 1 hora no Mapa
  const visibleBoats = boats.filter(b => {
    if (!b.last_updated) return true;
    const diff = (currentTime - new Date(b.last_updated).getTime()) / 3600000;
    return diff < 1; // 1 hora
  });

  const mapSelectedBoat = boats.find(b => b.id === selectedMapBoatId);
  const trackFoundBoat = boats.find(b => b.name.toLowerCase() === boatName.toLowerCase());

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => setView('track')} style={navBtnStyle}><Play size={22} /> Transmitir</button>
        <button onClick={() => setView('admin')} style={navBtnStyle}><Settings size={22} /> Admin</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {view === 'map' && (
          <>
            <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', transition: 'all 0.3s ease' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapAutoZoom boats={visibleBoats} selectedMapBoatId={selectedMapBoatId} />
                {visibleBoats.map(boat => boat.lat && (
                  <Marker 
                    key={boat.id} 
                    position={[boat.lat, boat.lng]} 
                    icon={boatIcon(boat.type, getBoatStatus(boat.last_updated))}
                    eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }}
                  >
                    {!selectedMapBoatId && (
                      <Popup><div style={{ fontWeight: 'bold' }}>{boat.name}</div></Popup>
                    )}
                  </Marker>
                ))}
              </MapContainer>
            </div>
            
            {selectedMapBoatId && mapSelectedBoat && (
              <div style={{ flex: '1 1 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto', boxShadow: '0 -4px 10px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h2 style={{ margin: 0, color: '#1e293b', fontSize: '22px' }}>{mapSelectedBoat.name}</h2>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{mapSelectedBoat.type}</span>
                </div>
                
                {getBoatStatus(mapSelectedBoat.last_updated) !== 'online' && (
                  <div style={{ background: '#fff7ed', color: '#9a3412', padding: '10px', borderRadius: '10px', fontSize: '13px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #ffedd5' }}>
                    <AlertTriangle size={18} /> Sinal instável! Última posição há {Math.floor((currentTime - new Date(mapSelectedBoat.last_updated).getTime()) / 60000)} minutos.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                  <div style={infoCardStyle}>
                    <Navigation size={16} color="#059669" />
                    <div><span style={infoLabel}>Distância Est.</span><br/><strong>{mapSelectedBoat.distance?.toFixed(2) || 0} km</strong></div>
                  </div>
                  <div style={infoCardStyle}>
                    <Activity size={16} color="#2563eb" />
                    <div><span style={infoLabel}>Último Sinal</span><br/><strong>{new Date(mapSelectedBoat.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></div>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '8px' }}>
                    <Users size={18} /> Tripulação Atual (Transmitindo)
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '10px', fontSize: '15px' }}>
                    {mapSelectedBoat.current_crew?.length > 0 ? mapSelectedBoat.current_crew.join(', ') : 'Não informada'}
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '8px' }}>
                    <RefreshCw size={18} /> Próximas Trocas (Fila)
                  </div>
                  {mapSelectedBoat.crew_queue?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {mapSelectedBoat.crew_queue.map((q, i) => (
                        <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px', fontSize: '14px' }}>
                          <strong style={{ color: '#94a3b8', marginRight: '10px' }}>#{i+1}</strong> {q.join(', ')}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '14px' }}>Nenhuma equipe aguardando.</div>
                  )}
                </div>
                
                <button onClick={() => { setView('track'); setBoatName(mapSelectedBoat.name); }} style={{ ...startBtnStyle, marginTop: '25px', background: '#0f172a' }}>
                  Gerenciar Este Barco
                </button>
              </div>
            )}
          </>
        )}

        {view === 'track' && (
          <div style={{ padding: '30px 20px', overflowY: 'auto', width: '100%', boxSizing: 'border-box' }}>
            {!isTracking ? (
              <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', maxWidth: '500px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Anchor size={40} color="#1e3a8a" />
                  {boatName && (
                    <button onClick={resetLocalState} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#475569', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                      <LogOut size={14} /> Sair deste Barco
                    </button>
                  )}
                </div>
                <h2 style={{ margin: '10px 0 5px 0', color: '#1e293b' }}>Rastreador GPS</h2>
                <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '14px' }}>Informe o barco e a tripulação.</p>
                
                <label style={labelStyle}>Nome do Barco</label>
                <input placeholder="Ex: Guanabara 01" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                
                {trackFoundBoat ? (
                  <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '15px', textAlign: 'left' }}>
                    <div style={{ color: '#059669', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>✓ Barco Localizado ({trackFoundBoat.type})</div>
                    <div style={{ fontSize: '13px', marginBottom: '15px' }}>
                      <strong>Remando agora:</strong> {trackFoundBoat.current_crew?.join(', ') || '?'}<br/>
                      <strong>Distância:</strong> {trackFoundBoat.distance?.toFixed(2) || 0} km
                    </div>
                    
                    <label style={labelStyle}>Sua Equipe (Nomes)</label>
                    <input placeholder="Ex: João, Maria" value={crewInput} onChange={e => setCrewInput(e.target.value)} style={inputStyle} />
                    
                    <button onClick={() => joinQueue(trackFoundBoat.id)} style={{ ...startBtnStyle, background: '#475569', marginTop: '10px' }}>Entrar na Fila</button>
                    <button onClick={() => takeControl(trackFoundBoat.id)} style={{ ...startBtnStyle, marginTop: '10px' }}>Assumir Controle</button>
                  </div>
                ) : (
                  <div style={{ marginTop: '15px', textAlign: 'left' }}>
                    <label style={labelStyle}>Categoria e Tipo</label>
                    <select style={inputStyle} onChange={(e) => { setCategory(e.target.value); setBoatType(''); }} value={category}>
                      <option value="">Selecione...</option>
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
                    <button onClick={startNewTracking} style={startBtnStyle}>Criar e Iniciar GPS</button>
                  </div>
                )}
              </div>
            ) : (
              <div style={activeTrackStyle}>
                <div style={{ animation: 'pulse 2s infinite', fontSize: '40px' }}>📡</div>
                <h2 style={{ color: '#059669', margin: '15px 0' }}>TRANSMITINDO</h2>
                <p style={{ fontSize: '20px', margin: '5px 0' }}><strong>{trackFoundBoat?.name || boatName}</strong></p>
                <div style={{ background: '#fef3c7', padding: '15px', borderRadius: '12px', fontSize: '13px', color: '#92400e', marginBottom: '25px', textAlign: 'left' }}>
                  ⚠️ Mantenha esta aba aberta. O GPS do celular só funciona com o navegador ativo.
                </div>
                <button onClick={() => stopTracking()} style={stopBtnStyle}>Encerrar Transmissão</button>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <h3 style={{ color: '#1e293b' }}>Status da Frota</h3>
            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '10px', padding: '15px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{b.name}</div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>{b.distance?.toFixed(2) || 0} km</div>
                </div>
                <div style={{ color: getBoatStatus(b.last_updated) === 'online' ? '#059669' : '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}>
                  {getBoatStatus(b.last_updated).toUpperCase()}
                </div>
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
const inputStyle = { width: '100%', padding: '14px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '15px', outline: 'none' };
const startBtnStyle = { width: '100%', padding: '16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' };
const stopBtnStyle = { width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' };
const activeTrackStyle = { border: '3px solid #10b981', padding: '40px 20px', borderRadius: '25px', background: '#ecfdf5', textAlign: 'center', maxWidth: '500px', margin: '0 auto' };
const infoCardStyle = { display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '10px', fontSize: '14px', border: '1px solid #e2e8f0' };
const infoLabel = { fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' };
