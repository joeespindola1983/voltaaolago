import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle, Trash2, UserMinus, X, Battery, Trophy } from 'lucide-react';

// --- CONFIGURAÇÕES ---
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

const boatIcon = (name, status = 'online', isMe = false, customColor) => {
  const statusColors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const baseColor = customColor || (isMe ? '#10b981' : statusColors[status] || statusColors.online);
  
  return L.divIcon({
    html: `<div style="display: flex; flex-direction: column; align-items: center; width: 100px;">
            <div style="background-color: ${baseColor}; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); ${isMe ? 'outline: 3px solid #10b981; outline-offset: 2px;' : ''}">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-2 10-2 10 2 10 2l-2 8H4l-2-8Z"/><path d="M12 10V2l4 4-4 4Z"/>
              </svg>
            </div>
            <div style="background: rgba(255,255,255,0.9); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 4px; border: 1px solid #cbd5e1; white-space: nowrap; color: #1e293b; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              ${name}
            </div>
           </div>`,
    className: '', iconSize: [100, 60], iconAnchor: [50, 20], popupAnchor: [0, -20]
  });
};

const clusterIcon = (count) => L.divIcon({
  html: `<div style="background-color: #1e3a8a; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: white; fontWeight: bold; font-size: 16px;">${count}</div>`,
  className: '', iconSize: [44, 44], iconAnchor: [22, 22]
});

function BoatLayer({ boats, trackingBoatId, setSelectedMapBoatId, setClusterModalBoats, currentTime }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const groups = [];
  const processedIds = new Set();
  const active = boats.filter(b => b.lat && b.lng && (currentTime - new Date(b.last_updated).getTime()) < 3600000);
  const clusterThreshold = 0.0004 * Math.pow(2, 16 - zoom);

  active.forEach(b => {
    if (processedIds.has(b.id)) return;
    const near = active.filter(other => {
      if (processedIds.has(other.id)) return false;
      const dist = Math.sqrt(Math.pow(b.lat - other.lat, 2) + Math.pow(b.lng - other.lng, 2));
      return dist < clusterThreshold;
    });
    near.forEach(n => processedIds.add(n.id));
    groups.push({ anchor: b, members: near });
  });

  return (
    <>
      {active.map(b => (
        b.trail && b.trail.length > 1 && (
          <Polyline 
            key={`trail-${b.id}`} 
            positions={b.trail.map(t => [t.lat, t.lng])} 
            pathOptions={{ color: b.color || '#2563eb', weight: 3, opacity: 0.6, dashArray: '5, 10' }} 
          />
        )
      ))}
      {groups.map(group => {
        const { anchor, members } = group;
        if (members.length === 1) {
          const boat = members[0];
          const diff = (currentTime - new Date(boat.last_updated).getTime()) / 60000;
          const status = diff < 5 ? 'online' : (diff < 10 ? 'warning' : 'lost');
          return (
            <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.name, status, boat.id === trackingBoatId, boat.color)} eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }} />
          );
        }
        return (
          <Marker key={`cluster-${anchor.id}`} position={[anchor.lat, anchor.lng]} icon={clusterIcon(members.length)} eventHandlers={{ click: () => setClusterModalBoats(members) }} />
        );
      })}
    </>
  );
}

function MapAutoZoom({ boats, selectedMapBoatId, focusBoatId }) {
  const map = useMap();
  const [isFollowing, setIsFollowing] = useState(true);

  // Resetar o follow e forçar o Leaflet a recalcular o tamanho do container quando a seleção mudar
  useEffect(() => {
    setIsFollowing(true);
    // Pequeno delay para esperar a transição do CSS (.3s)
    const timer = setTimeout(() => {
      map.invalidateSize({ animate: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedMapBoatId, focusBoatId, map]);

  useEffect(() => {
    const focusId = focusBoatId || selectedMapBoatId;
    if (focusId && isFollowing) {
      const b = boats.find(x => Number(x.id) === Number(focusId));
      if (b && b.lat && b.lng) {
        map.setView([b.lat, b.lng], 16, { animate: true });
      }
    } else if (!focusId) {
      const activeBoats = boats.filter(b => b.lat && b.lng);
      if (activeBoats.length > 0) {
        const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
      }
    }
  }, [boats, map, selectedMapBoatId, focusBoatId, isFollowing]);

  // Se o usuário arrastar o mapa, para de seguir o barco temporariamente
  useMapEvents({
    dragstart: () => {
      if (selectedMapBoatId || focusBoatId) setIsFollowing(false);
    },
    click: (e) => {
      // Se clicar no mapa (não num marcador), limpa a seleção
      // O Leaflet propaga o clique, então verificamos se o clique foi no "container"
      if (e.originalEvent.target.classList.contains('leaflet-container')) {
        // Esta lógica será disparada pelo MapEvents abaixo
      }
    }
  });

  return null;
}

function MapEventHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => {
      // O clique do Leaflet propaga. Verificamos se foi no fundo do mapa.
      if (e.originalEvent.target.classList.contains('leaflet-container')) {
        onMapClick();
      }
    }
  });
  return null;
}

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem('vtl_view') || 'map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [clusterModalBoats, setClusterModalBoats] = useState(null);

  useEffect(() => { localStorage.setItem('vtl_view', view); }, [view]);
  const [boatName, setBoatName] = useState('');
  const [category, setCategory] = useState('');
  const [boatType, setBoatType] = useState('');
  const [boatColor, setBoatColor] = useState('#2563eb');
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [athletes, setAthletes] = useState([]);
  const [exchanges, setExchanges] = useState([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [editingBoatId, setEditingBoatId] = useState(null);
  const [selectedExchangeIndex, setSelectedExchangeIndex] = useState(0);
  const [crewInput, setCrewInput] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vtl_admin') === 'true');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('u') === 'admin' && params.get('p') === 'lago2026') { 
      setIsAdmin(true); 
      localStorage.setItem('vtl_admin', 'true');
      setView('admin'); 
      window.history.replaceState({}, document.title, "/"); 
    }
  }, []);

  useEffect(() => {
    if (trackingBoatId) {
      localStorage.setItem('vtl_tracking_id', trackingBoatId);
    } else {
      localStorage.removeItem('vtl_tracking_id');
    }
  }, [trackingBoatId]);

  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [nextSyncCountdown, setNextSyncCountdown] = useState(0);
  const isTrackingRef = useRef(false);
  const trackingBoatIdRef = useRef(trackingBoatId);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Efeito para o Cronômetro de Sincronização
  useEffect(() => {
    if (!isTracking) {
      setNextSyncCountdown(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const nextSync = lastSentRef.current + (relayTimeoutRef.current * 60000);
      const remaining = Math.max(0, Math.ceil((nextSync - now) / 1000));
      setNextSyncCountdown(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [isTracking]);
  const [relayTimeout, setRelayTimeout] = useState(1);
  const relayTimeoutRef = useRef(1);
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    const fetchTimer = setInterval(() => fetchBoats(), 60000);
    return () => { clearInterval(timer); clearInterval(fetchTimer); };
  }, []);

  const selectedMapBoatIdRef = useRef(null);
  useEffect(() => { selectedMapBoatIdRef.current = selectedMapBoatId; }, [selectedMapBoatId]);

  useEffect(() => {
    fetchBoats();
    socket.on('config_updated', (data) => { setRelayTimeout(data.relayTimeout); relayTimeoutRef.current = data.relayTimeout; });
    socket.on('location_changed', (data) => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(data.boatId)) {
        setLastSuccessfulUpdate(Date.now());
        setSyncStatus('ok');
        setTimeout(() => {
          if (isTrackingRef.current) setSyncStatus('idle');
        }, 3000);
      }
      setBoats(prev => {
        if (!prev.find(b => Number(b.id) === Number(data.boatId))) { fetchBoats(); return prev; }
        return prev.map(b => {
          if (Number(b.id) === Number(data.boatId)) {
            const newTrail = [...(b.trail || []), { lat: data.lat, lng: data.lng }].slice(-30);
            return { ...b, ...data, trail: newTrail, last_updated: data.lastUpdated };
          }
          return b;
        });
      });
    });
    socket.on('boat_updated', (updatedBoat) => {
      setBoats(prev => {
        if (prev.find(b => Number(b.id) === Number(updatedBoat.id))) return prev.map(b => Number(b.id) === Number(updatedBoat.id) ? { ...b, ...updatedBoat } : b);
        return [...prev, updatedBoat];
      });
    });
    socket.on('boat_deleted', (data) => {
      setBoats(prev => prev.filter(b => Number(b.id) !== Number(data.id)));
      if (Number(selectedMapBoatIdRef.current) === Number(data.id)) setSelectedMapBoatId(null);
    });
    socket.on('control_taken', (data) => { if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(data.boatId)) { alert("Controle assumido!"); stopTracking(true); } });
    return () => { socket.off('config_updated'); socket.off('location_changed'); socket.off('boat_updated'); socket.off('boat_deleted'); socket.off('control_taken'); };
  }, []);

  // Resume tracking automatically if boat data is loaded and tracking session exists
  useEffect(() => {
    if (trackingBoatId && boats.length > 0 && !isTracking) {
      const b = boats.find(x => Number(x.id) === Number(trackingBoatId));
      if (b) {
        setBoatName(b.name); setBoatType(b.type); setNickname(b.nickname);
        setIsTracking(true); isTrackingRef.current = true;
        // Tenta reativar o WakeLock se disponível
        if ('wakeLock' in navigator) {
          navigator.wakeLock.request('screen').then(lock => { wakeLockRef.current = lock; }).catch(() => {});
        }
        trackLocation(b.id);
      }
    }
  }, [boats, trackingBoatId]);

  const fetchBoats = async () => {
    try { const res = await axios.get(`${API_URL}/api/boats`); setBoats(res.data); } catch (err) { console.error('Erro API:', err); }
  };

  const startNewTracking = async () => {
    if (!boatName || !boatType || !crewInput) return alert('Preencha tudo!');
    try {
      const res = await axios.post(`${API_URL}/api/boats`, { name: boatName, type: boatType, current_crew: crewInput.split(',').map(s => s.trim()) });
      activateHardwareGPS(res.data.id);
    } catch (err) { alert('Erro ao criar.'); }
  };

  const activateHardwareGPS = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio; 
      setTrackingBoatId(id); 
      trackingBoatIdRef.current = id;
      setIsTracking(true); 
      isTrackingRef.current = true;
      trackLocation(id);
    } catch (err) { alert('Erro GPS.'); }
  };

  const stopTracking = (forceMap = false) => {
    setIsTracking(false); 
    isTrackingRef.current = false;
    setTrackingBoatId(null);
    trackingBoatIdRef.current = null;
    localStorage.removeItem('vtl_tracking_id');
    setSyncStatus('idle');
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    if (forceMap) setView('map'); else window.location.reload();
  };

  const trackLocation = (id) => {
    if (!isTrackingRef.current) return;
    if (!navigator.geolocation) return;

    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (!isTrackingRef.current) return;
        
        const now = Date.now();
        if (!lastSentRef.current || (now - lastSentRef.current) >= (relayTimeoutRef.current * 60000)) {
          setSyncStatus('sending');
          
          let batteryLevel = 100;
          try {
            if ('getBattery' in navigator) {
              const battery = await navigator.getBattery();
              batteryLevel = Math.round(battery.level * 100);
            }
          } catch (e) {}

          socket.emit('update_location', { 
            boatId: id, 
            lat: pos.coords.latitude, 
            lng: pos.coords.longitude,
            speed: pos.coords.speed,
            batteryLevel
          });
          lastSentRef.current = now;
        }
      },
      (err) => { 
        console.error("GPS Error:", err);
        setSyncStatus('error');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
    
    watchIdRef.current = watchId;
  };

  const calculatePace = (speedKmh) => {
    if (!speedKmh || speedKmh < 0.5) return '--:--';
    const paceDecimal = 60 / speedKmh;
    const mins = Math.floor(paceDecimal);
    const secs = Math.round((paceDecimal - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const BoatDetails = ({ boat, onClose }) => (
    <div style={{ flex: '0 0 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>{boat.name}</h2>
          {boat.battery_level !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: boat.battery_level < 20 ? '#ef4444' : '#64748b', fontWeight: 'bold' }}>
              <Battery size={14} color={boat.battery_level < 20 ? '#ef4444' : '#64748b'} /> {boat.battery_level}%
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }}>Fechar</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '15px' }}>
        <div style={infoCardStyle}><Navigation size={14} color="#059669" /><div><span style={infoLabel}>KM</span><br/><strong>{boat.distance?.toFixed(2) || 0}</strong></div></div>
        <div style={infoCardStyle}><Activity size={14} color="#2563eb" /><div><span style={infoLabel}>Km/h</span><br/><strong>{boat.speed || 0}</strong></div></div>
        <div style={infoCardStyle}><RefreshCw size={14} color="#f59e0b" /><div><span style={infoLabel}>Ritmo</span><br/><strong>{calculatePace(boat.speed)}</strong></div></div>
      </div>
      <div style={{ marginBottom: '15px' }}>
        <div style={sectionTitleStyle}><Users size={16} /> Tripulação Atual</div>
        <div style={crewBoxStyle}>{boat.current_crew?.join(', ') || 'Ninguém'}</div>
      </div>
      {boat.exchanges?.length > 0 && (
        <div style={{ marginBottom: '15px' }}>
          <div style={sectionTitleStyle}><RefreshCw size={16} /> Próximos Trechos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {boat.exchanges.map((ex, i) => (
              <div key={i} style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', fontSize: '11px', border: '1px solid #e2e8f0' }}>
                <strong>Trecho {i + 1}:</strong> {ex.join(', ')}
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => { 
        setView('track'); 
        setNickname(boat.nickname || ''); 
        setBoatName(boat.name); 
        setSelectedMapBoatId(null); 
      }} style={{ ...startBtnStyle, marginTop: '10px', background: '#0f172a' }}>Assumir Barco</button>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => { setView('ranking'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Trophy size={22} /> Ranking</button>
        <button onClick={() => { setView('boats'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Ship size={22} /> Barcos</button>
        <button onClick={() => { setView('track'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Play size={22} /> Transmitir</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Modal de Barcos Sobrepostos (Global) */}
        {clusterModalBoats && (
          <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>Barcos nesta área</h3>
                <button onClick={() => setClusterModalBoats(null)} style={{ background: 'none', border: 'none' }}><X size={24} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {clusterModalBoats.map(b => (
                  <button key={b.id} onClick={() => { setSelectedMapBoatId(b.id); setClusterModalBoats(null); }} style={modalButtonStyle}>
                    <strong>{b.name}</strong> ({b.type})
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            <h2 style={{ margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '10px' }}><Trophy color="#f59e0b" /> Classificação Geral</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[...boats].sort((a, b) => (b.distance || 0) - (a.distance || 0)).map((b, i) => {
                const diff = (currentTime - new Date(b.last_updated).getTime()) / 60000;
                const isOnline = b.lat && b.lng && diff < 5;
                return (
                  <div key={b.id} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }} style={{ background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: i < 3 ? '#f59e0b' : '#94a3b8', width: '30px' }}>{i + 1}º</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color }} />
                        {b.name}
                        {isOnline && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>@{b.nickname} • {b.type}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1e3a8a' }}>{b.distance?.toFixed(2) || '0.00'} <span style={{ fontSize: '10px' }}>km</span></div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{calculatePace(b.speed)} min/km</div>
                    </div>
                  </div>
                );
              })}
              {boats.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Nenhum barco na disputa ainda.</div>}
            </div>
          </div>
        )}

        {view === 'boats' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            {!isRegistering ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0 }}>Barcos Cadastrados</h2>
                  <button onClick={() => { setIsRegistering(true); setEditingBoatId(null); setNickname(''); setBoatName(''); setPin(''); setAthletes([]); setExchanges([]); setBoatColor('#2563eb'); }} style={{ ...startBtnStyle, width: 'auto', padding: '10px 20px' }}>+ Novo Barco</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {boats.map(b => {
                    const diff = (currentTime - new Date(b.last_updated).getTime()) / 60000;
                    const isOnline = b.lat && b.lng && diff < 5;
                    return (
                      <div key={b.id} style={{ background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ position: 'relative' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color || '#2563eb' }} />
                            {isOnline && <div style={{ position: 'absolute', top: -2, right: -2, width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', border: '1px solid white' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: 'bold', color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {b.name} 
                              {isOnline && <span style={{ fontSize: '9px', background: '#ecfdf5', color: '#059669', padding: '1px 4px', borderRadius: '4px' }}>LIVE</span>}
                              {b.battery_level !== undefined && (
                                <span style={{ fontSize: '9px', color: b.battery_level < 20 ? '#ef4444' : '#64748b', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <Battery size={10} /> {b.battery_level}%
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>@{b.nickname} • {b.type}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => {
                            const text = `Acesso ao barco *${b.name}*:\nNickname: *@${b.nickname}*\nSenha: *${b.pin}*\nLink: ${window.location.origin}`;
                            navigator.clipboard.writeText(text).then(() => alert('Dados de acesso copiados! Envie para sua equipe.'));
                          }} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                            <RefreshCw size={16} color="#64748b" />
                          </button>
                          <button onClick={() => {
                            const p = prompt('Digite a SENHA de 4 números:');
                            if (p === b.pin) {
                              setEditingBoatId(b.id); setBoatName(b.name); setNickname(b.nickname); setPin(b.pin); setAthletes(b.athletes || []); setExchanges(b.exchanges || []); setBoatType(b.type); setBoatColor(b.color || '#2563eb'); setIsRegistering(true);
                            } else if (p !== null) alert('SENHA incorreta!');
                          }} style={{ background: '#f1f5f9', border: 'none', padding: '10px 15px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold' }}>Gerenciar</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', maxWidth: '500px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0 }}>{editingBoatId ? 'Editar Barco' : 'Novo Barco'}</h2>
                  <button onClick={() => setIsRegistering(false)} style={{ background: 'none', border: 'none' }}><X size={24} /></button>
                </div>
                
                <label style={labelStyle}>Nickname (@id único alfanumérico)</label>
                <input placeholder="ex: oc6lago" value={nickname} onChange={e => setNickname(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} style={inputStyle} />
                
                <label style={labelStyle}>Nome do Barco</label>
                <input placeholder="Ex: Vento Leste" value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                  <div>
                    <label style={labelStyle}>SENHA (4 números visíveis)</label>
                    <input 
                      type="text" 
                      inputMode="numeric" 
                      pattern="[0-9]*" 
                      maxLength={4} 
                      placeholder="Ex: 1234" 
                      value={pin} 
                      onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))} 
                      style={inputStyle} 
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Tipo de Barco</label>
                    <select style={inputStyle} onChange={(e) => setBoatType(e.target.value)} value={boatType}>
                      <option value="">Selecione...</option>
                      {Object.values(BOAT_CATEGORIES).flat().map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <label style={labelStyle}>Cor no Mapa</label>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
                  {['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#1e293b'].map(c => (
                    <button key={c} onClick={() => setBoatColor(c)} style={{ width: '34px', height: '34px', borderRadius: '50%', background: c, border: boatColor === c ? '3px solid #1e3a8a' : '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: 'pointer' }} />
                  ))}
                  <input type="color" value={boatColor} onChange={e => setBoatColor(e.target.value)} style={{ width: '34px', height: '34px', border: 'none', background: 'none', cursor: 'pointer' }} />
                </div>

                <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={18}/> Lista de Atletas</h3>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <input placeholder="Nome do Atleta" value={crewInput} onChange={e => setCrewInput(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
                    <button onClick={() => { if (crewInput) { setAthletes([...athletes, crewInput]); setCrewInput(''); } }} style={{ background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '10px', padding: '0 20px', fontWeight: 'bold' }}>+</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {athletes.map((a, i) => (
                      <span key={i} style={{ background: '#f1f5f9', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #e2e8f0' }}>
                        {a} <X size={14} onClick={() => setAthletes(athletes.filter((_, idx) => idx !== i))} style={{ cursor: 'pointer', color: '#94a3b8' }} />
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={18}/> Trechos (Trocas)</h3>
                  <button onClick={() => setExchanges([...exchanges, []])} style={{ background: '#f8fafc', border: '2px dashed #e2e8f0', width: '100%', padding: '12px', borderRadius: '12px', marginBottom: '15px', fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>+ Adicionar Novo Trecho</button>
                  
                  {exchanges.map((ex, exIdx) => (
                    <div key={exIdx} style={{ background: '#f8fafc', padding: '15px', borderRadius: '15px', marginBottom: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <strong style={{ fontSize: '14px', color: '#1e3a8a' }}>Trecho {exIdx + 1}</strong>
                        <button onClick={() => setExchanges(exchanges.filter((_, idx) => idx !== exIdx))} style={{ background: 'none', border: 'none', color: '#ef4444' }}><Trash2 size={16} /></button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {athletes.length === 0 && <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>Adicione atletas acima primeiro</div>}
                        {athletes.map(a => (
                          <button key={a} onClick={() => {
                            const isIncluded = ex.includes(a);
                            setExchanges(exchanges.map((e, idx) => idx === exIdx ? (isIncluded ? e.filter(name => name !== a) : [...e, a]) : e));
                          }} style={{ padding: '6px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', border: 'none', transition: 'all 0.2s', background: ex.includes(a) ? '#1e3a8a' : '#fff', color: ex.includes(a) ? '#fff' : '#64748b', boxShadow: ex.includes(a) ? '0 2px 5px rgba(30,58,138,0.3)' : 'inset 0 0 0 1px #cbd5e1' }}>
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={async () => {
                  if (!nickname || !boatName || pin.length < 4) return alert('Nickname, Nome e SENHA (4 números) são obrigatórios!');
                  try {
                    const payload = { name: boatName, type: boatType, nickname, pin, color: boatColor, athletes, exchanges };
                    if (editingBoatId) {
                      await axios.put(`${API_URL}/api/boats/${editingBoatId}`, payload);
                    } else {
                      await axios.post(`${API_URL}/api/boats`, payload);
                    }
                    alert('Barco salvo com sucesso!'); setIsRegistering(false); setEditingBoatId(null); fetchBoats();
                  } catch (err) { alert(err.response?.data?.error || 'Erro ao salvar'); }
                }} style={{ ...startBtnStyle, marginTop: '20px' }}>Salvar Barco</button>
              </div>
            )}
          </div>
        )}

        {view === 'map' && (
          <>
            <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', transition: 'all 0.3s ease' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapEventHandler onMapClick={() => setSelectedMapBoatId(null)} />
                <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={isTracking ? trackingBoatId : null} />
                <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} setClusterModalBoats={setClusterModalBoats} currentTime={currentTime} />
              </MapContainer>
            </div>
            {selectedMapBoatId && boats.find(b => Number(b.id) === Number(selectedMapBoatId)) && (
              <BoatDetails boat={boats.find(b => Number(b.id) === Number(selectedMapBoatId))} onClose={() => setSelectedMapBoatId(null)} />
            )}
          </>
        )}

        {view === 'track' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {!isTracking ? (
              <div style={{ padding: '30px 20px', overflowY: 'auto' }}>
                <div style={{ background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', maxWidth: '500px', margin: '0 auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <Anchor size={40} color="#1e3a8a" />
                    {trackingBoatId && <button onClick={() => { setTrackingBoatId(null); setNickname(''); setPin(''); }} style={{ background: '#f1f5f9', border: 'none', padding: '8px 15px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold' }}>Sair</button>}
                  </div>
                  
                  {!trackingBoatId ? (
                    <>
                      <h2 style={{ margin: '0 0 5px 0' }}>Acesso ao Barco</h2>
                      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>Identifique seu barco para começar a transmitir.</p>
                      
                      <label style={labelStyle}>Nickname (@id único)</label>
                      <input placeholder="ex: oc6lago" value={nickname} onChange={e => setNickname(e.target.value)} style={inputStyle} />
                      
                      <label style={labelStyle}>SENHA de 4 números</label>
                      <input 
                        type="text" 
                        inputMode="numeric" 
                        pattern="[0-9]*" 
                        maxLength={4} 
                        placeholder="Ex: 1234" 
                        value={pin} 
                        onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))} 
                        style={inputStyle} 
                      />
                      
                      <button onClick={async () => {
                        if (pin.length < 4) return alert('A SENHA deve ter 4 números!');
                        try {
                          const res = await axios.post(`${API_URL}/api/boats/auth`, { nickname, pin });
                          setBoatName(res.data.name); setBoatType(res.data.type); setAthletes(res.data.athletes || []); setExchanges(res.data.exchanges || []);
                          setTrackingBoatId(res.data.id); trackingBoatIdRef.current = res.data.id;
                        } catch (err) { alert('Credenciais inválidas!'); }
                      }} style={startBtnStyle}>Verificar Credenciais</button>
                    </>
                  ) : (
                    <div style={{ textAlign: 'left' }}>
                      <h2 style={{ margin: '0 0 5px 0' }}>{boatName}</h2>
                      <div style={{ fontSize: '14px', color: '#059669', fontWeight: 'bold', marginBottom: '20px' }}>✓ Acesso Autorizado</div>
                      
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>Selecione o Trecho Atual</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {exchanges.length === 0 && <p style={{ fontSize: '13px', color: '#ef4444' }}>Nenhum trecho configurado pelo capitão na aba "Barcos".</p>}
                        {exchanges.map((ex, i) => (
                          <button key={i} onClick={() => setSelectedExchangeIndex(i)} style={{ padding: '15px', borderRadius: '15px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', background: selectedExchangeIndex === i ? '#ecfdf5' : '#fff', border: selectedExchangeIndex === i ? '2px solid #10b981' : '1px solid #e2e8f0', boxShadow: selectedExchangeIndex === i ? '0 4px 12px rgba(16,185,129,0.1)' : 'none' }}>
                            <div style={{ fontWeight: 'bold', color: selectedExchangeIndex === i ? '#065f46' : '#1e293b' }}>Trecho {i + 1}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{ex.join(', ')}</div>
                          </button>
                        ))}
                      </div>
                      <button onClick={async () => {
                        if (exchanges.length === 0) return alert('O capitão precisa configurar os trechos primeiro!');
                        const selectedCrew = exchanges[selectedExchangeIndex];
                        await axios.post(`${API_URL}/api/boats/${trackingBoatId}/take_control`, { new_crew: selectedCrew });
                        activateHardwareGPS(trackingBoatId);
                      }} style={{ ...startBtnStyle, marginTop: '20px', background: '#10b981' }}>Assumir Trecho e Iniciar GPS</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: '#ecfdf5', padding: '15px 20px', borderBottom: '2px solid #10b981' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <div style={{ color: '#059669', fontWeight: 'bold', fontSize: '12px' }}>📡 TRANSMITINDO</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{boatName}</div>
                    </div>
                    <button onClick={() => stopTracking()} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '10px', fontWeight: 'bold' }}>PARAR</button>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ ...infoCardStyle, background: 'rgba(255,255,255,0.5)', padding: '8px 5px', flexDirection: 'column', textAlign: 'center' }}>
                      <Navigation size={16} color="#059669" />
                      <div><span style={infoLabel}>Km</span><br/><strong style={{ fontSize: '14px' }}>{boats.find(b => Number(b.id) === Number(trackingBoatId))?.distance?.toFixed(2) || '0.00'}</strong></div>
                    </div>
                    <div style={{ ...infoCardStyle, background: 'rgba(255,255,255,0.5)', padding: '8px 5px', flexDirection: 'column', textAlign: 'center' }}>
                      <Activity size={16} color="#2563eb" />
                      <div><span style={infoLabel}>Km/h</span><br/><strong style={{ fontSize: '14px' }}>{boats.find(b => Number(b.id) === Number(trackingBoatId))?.speed || '0.0'}</strong></div>
                    </div>
                    <div style={{ ...infoCardStyle, background: 'rgba(255,255,255,0.5)', padding: '8px 5px', flexDirection: 'column', textAlign: 'center' }}>
                      <RefreshCw size={16} color="#f59e0b" />
                      <div><span style={infoLabel}>Pace</span><br/><strong style={{ fontSize: '14px' }}>{calculatePace(boats.find(b => Number(b.id) === Number(trackingBoatId))?.speed)}</strong></div>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.1)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ fontSize: '11px', color: '#065f46', fontWeight: 'bold', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Users size={14}/> EQUIPE NO TRECHO {selectedExchangeIndex + 1}:
                    </div>
                    <div style={{ fontSize: '13px', color: '#047857' }}>
                      {exchanges[selectedExchangeIndex]?.join(', ') || 'Nenhum atleta escalado'}
                    </div>
                  </div>
                </div>
                <div style={{ flex: selectedMapBoatId ? '0 0 55%' : '1 1 100%', position: 'relative', transition: 'all 0.3s ease' }}>
                  <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <MapEventHandler onMapClick={() => setSelectedMapBoatId(null)} />
                    <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={trackingBoatId} />
                    <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} setClusterModalBoats={setClusterModalBoats} currentTime={currentTime} />
                  </MapContainer>

                  {/* Indicador de Sincronização Inteligente com Countdown */}
                  <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(255,255,255,0.95)', padding: '12px 24px', borderRadius: '30px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                    <div style={{ 
                      width: '12px', height: '12px', borderRadius: '50%', 
                      background: syncStatus === 'error' ? '#ef4444' : (syncStatus === 'sending' ? '#2563eb' : (syncStatus === 'ok' ? '#10b981' : '#f59e0b')),
                      animation: (syncStatus === 'sending' || syncStatus === 'idle') ? 'pulse 1s infinite' : 'none'
                    }} />
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>
                      {syncStatus === 'sending' ? '📡 Sincronizando agora...' : 
                       syncStatus === 'error' ? '⚠️ Erro de GPS' :
                       syncStatus === 'ok' ? '✅ Sincronizado agora!' :
                       nextSyncCountdown > 0 ? `Próxima sincronização em ${nextSyncCountdown}s` :
                       'Aguardando sinal GPS...'}
                    </span>
                  </div>
                </div>
                {selectedMapBoatId && boats.find(b => Number(b.id) === Number(selectedMapBoatId)) && (
                  <BoatDetails boat={boats.find(b => Number(b.id) === Number(selectedMapBoatId))} onClose={() => setSelectedMapBoatId(null)} />
                )}
              </>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Painel de Controle Admin</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { setIsAdmin(false); localStorage.removeItem('vtl_admin'); setView('map'); }} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px' }}>Logoff</button>
                <button onClick={() => setView('map')} style={{ background: '#475569', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px' }}>Sair</button>
              </div>
            </div>
            
            <div style={{ background: 'white', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
              <label style={labelStyle}>Intervalo de GPS (Global)</label>
              <select value={relayTimeout} onChange={(e) => axios.post(`${API_URL}/api/config`, { relayTimeout: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }}>
                {[1,2,3,4,5,10].map(n => <option key={n} value={n}>Relay GPS: {n} min</option>)}
              </select>
            </div>

            <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Barcos no Sistema ({boats.length})</h3>
            {boats.map(b => (
              <div key={b.id} style={{ background: 'white', marginBottom: '10px', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color }} />
                    <strong>{b.name}</strong>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>@{b.nickname} • {b.distance?.toFixed(2)} km • {b.type}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={async () => {
                    if (window.confirm(`Resetar distância e rastro de "${b.name}"?`)) {
                      await axios.post(`${API_URL}/api/boats/${b.id}/reset`);
                      fetchBoats();
                    }
                  }} style={{ color: '#f59e0b', border: 'none', background: '#fffbeb', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                    <RefreshCw size={20} />
                  </button>
                  <button onClick={async () => { 
                    if (window.confirm(`TEM CERTEZA? Isso removerá o barco "${b.name}" (@${b.nickname}) COMPLETAMENTE do sistema, incluindo histórico e atletas.`)) {
                      try {
                        await axios.delete(`${API_URL}/api/boats/${b.id}`);
                        fetchBoats();
                      } catch (err) { alert('Erro ao remover barco'); }
                    }
                  }} style={{ color: '#ef4444', border: 'none', background: '#fef2f2', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                    <Trash2 size={20} />
                  </button>
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
const infoCardStyle = { display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '10px', borderRadius: '10px', fontSize: '13px', border: '1px solid #e2e8f0' };
const infoLabel = { fontSize: '10px', color: '#64748b', textTransform: 'uppercase' };
const sectionTitleStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' };
const crewBoxStyle = { background: '#f1f5f9', padding: '10px', borderRadius: '8px', fontSize: '14px' };
const modalOverlayStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const modalContentStyle = { background: 'white', borderRadius: '20px', padding: '20px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' };
const modalButtonStyle = { background: '#f1f5f9', border: 'none', padding: '15px', borderRadius: '12px', textAlign: 'left', fontSize: '16px', cursor: 'pointer', color: '#1e3a8a' };
