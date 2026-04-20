import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, LayersControl } from 'react-leaflet';
const { BaseLayer } = LayersControl;
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle, Trash2, UserMinus, X, Battery, Trophy } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';

// --- CONFIGURAÇÕES ---
const isApp = Capacitor.isNativePlatform();
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : BACKEND_URL;
const socket = io(API_URL);

const BOAT_CATEGORIES = {
  'Olímpico': ['1x', '2x', '4x', '8x'],
  'Canoa (OC/V)': ['OC1', 'OC2', 'OC3', 'OC6', 'V1', 'V2', 'V3'],
  'Outros': ['Surfski', 'Caiaque', 'Stand Up']
};

const boatIcon = (name, status = 'online', isMe = false, customColor, heading = 0, isSos = false, isLeader = false) => {
  const statusColors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const baseColor = isSos ? '#ef4444' : (customColor || (isMe ? '#10b981' : statusColors[status] || statusColors.online));
  const animation = isSos ? 'pulse 0.5s infinite' : 'none';
  const glow = isLeader ? '0 0 15px #f59e0b, 0 0 5px #f59e0b' : '0 4px 10px rgba(0,0,0,0.4)';
  
  return L.divIcon({
    html: `<div style="display: flex; flex-direction: column; align-items: center; width: 100px;">
            <div style="background-color: ${baseColor}; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border: 3px solid ${isLeader ? '#f59e0b' : 'white'}; box-shadow: ${glow}; ${isMe ? 'outline: 3px solid #10b981; outline-offset: 2px;' : ''}; transition: transform 0.5s ease; transform: rotate(${heading}deg); animation: ${animation};">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/>
              </svg>
              ${isLeader ? '<div style="position: absolute; top: -10px; right: -10px; background: #f59e0b; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transform: rotate(' + (-heading) + 'deg); font-size: 10px;">🏆</div>' : ''}
            </div>
            <div style="background: ${isSos ? '#ef4444' : 'rgba(255,255,255,0.9)'}; color: ${isSos ? '#fff' : '#1e293b'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 6px; border: 1px solid ${isSos ? '#b91c1c' : (isLeader ? '#f59e0b' : '#cbd5e1')}; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transform: rotate(0deg);">
              ${isSos ? '⚠️ SOS: ' : ''}${name}
            </div>
           </div>`,
    className: '', iconSize: [100, 70], iconAnchor: [50, 21], popupAnchor: [0, -20]
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

  // Identificar líderes de categoria para destaque visual
  const categoryLeaders = {};
  boats.forEach(b => {
    if (!categoryLeaders[b.category] || (b.distance > (categoryLeaders[b.category].distance || 0))) {
      categoryLeaders[b.category] = b;
    }
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
          const isLeader = categoryLeaders[boat.category]?.id === boat.id && boat.distance > 0;
          
          return (
            <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.name, status, boat.id === trackingBoatId, boat.color, boat.heading, boat.sos_active, isLeader)} eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }} />
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

function RaceClock({ startTime }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      const diff = Date.now() - startTime;
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setElapsed(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (!startTime) return null;

  return (
    <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(30,58,138,0.9)', color: 'white', padding: '8px 20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', textAlign: 'center', border: '2px solid white' }}>
      <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', opacity: 0.8 }}>Tempo de Prova</div>
      <div style={{ fontSize: '20px', fontWeight: '900', fontFamily: 'monospace' }}>{elapsed}</div>
    </div>
  );
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
  const [boatCategory, setBoatCategory] = useState('Geral');
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [athletes, setAthletes] = useState([]);
  const [exchanges, setExchanges] = useState([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [editingBoatId, setEditingBoatId] = useState(null);
  const [selectedExchangeIndex, setSelectedExchangeIndex] = useState(0);
  const [boatSplits, setBoatSplits] = useState([]);
  const [crewInput, setCrewInput] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vtl_admin') === 'true');
  const [activeRankingCategory, setActiveRankingCategory] = useState('Geral');
  const [raceStartTime, setRaceStartTime] = useState(null);

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
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const isTrackingRef = useRef(false);

  useEffect(() => {
    const onConnect = () => setIsSocketConnected(true);
    const onDisconnect = () => setIsSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Flush buffer quando a internet voltar
  useEffect(() => {
    if (isSocketConnected && isTracking) {
      const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
      if (buffer.length > 0) {
        buffer.forEach(data => socket.emit('update_location', data));
        localStorage.removeItem('vtl_gps_buffer');
        console.log(`Sincronizados ${buffer.length} pontos offline.`);
      }
    }
  }, [isSocketConnected, isTracking]);
  const trackingBoatIdRef = useRef(trackingBoatId);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight || window.innerWidth > 768);

  useEffect(() => {
    const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight || window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  useEffect(() => {
    if (selectedMapBoatId) {
      axios.get(`${API_URL}/api/boats/${selectedMapBoatId}/splits`).then(res => setBoatSplits(res.data)).catch(() => {});
    } else {
      setBoatSplits([]);
    }
  }, [selectedMapBoatId]);

  useEffect(() => {
    fetchBoats();
    socket.on('config_updated', (data) => { 
      setRelayTimeout(data.relayTimeout); 
      relayTimeoutRef.current = data.relayTimeout; 
      setRaceStartTime(data.raceStartTime);
    });
    socket.on('sos_alert', (data) => {
      alert(`🚨 EMERGÊNCIA: O barco ${data.boatName} ativou o SOS!`);
    });
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

    if (watchIdRef.current) {
      if (isApp) {
        Geolocation.clearWatch({ id: watchIdRef.current });
      } else {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    }

    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    if (forceMap) setView('map'); else window.location.reload();
  };
  const trackLocation = (id) => {
    if (!isTrackingRef.current) return;

    if (isApp) {
      const startNativeTracking = async () => {
        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 20000 },
          async (pos, err) => {
            if (err || !pos || !isTrackingRef.current) return;
            
            const now = Date.now();
            if (!lastSentRef.current || (now - lastSentRef.current) >= (relayTimeoutRef.current * 60000)) {
              setSyncStatus('sending');
              
              let batteryLevel = 100;
              try {
                const batteryInfo = await Device.getBatteryInfo();
                batteryLevel = Math.round(batteryInfo.batteryLevel * 100);
              } catch (e) {}

              const payload = { 
                boatId: id, 
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude,
                speed: pos.coords.speed,
                heading: pos.coords.heading,
                batteryLevel
              };

              if (socket.connected) {
                socket.emit('update_location', payload);
              } else {
                const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
                buffer.push(payload);
                localStorage.setItem('vtl_gps_buffer', JSON.stringify(buffer.slice(-50)));
              }
              setGpsAccuracy(pos.coords.accuracy);
              lastSentRef.current = now;
            }
          }
        );
        watchIdRef.current = watchId;
      };
      startNativeTracking();
    } else {
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

            const payload = { 
              boatId: id, 
              lat: pos.coords.latitude, 
              lng: pos.coords.longitude,
              speed: pos.coords.speed,
              heading: pos.coords.heading,
              batteryLevel
            };

            if (socket.connected) {
              socket.emit('update_location', payload);
            } else {
              const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
              buffer.push(payload);
              localStorage.setItem('vtl_gps_buffer', JSON.stringify(buffer.slice(-50)));
            }

            setGpsAccuracy(pos.coords.accuracy);
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
    }
  };

  const calculatePace = (speedKmh) => {
    if (!speedKmh || speedKmh < 0.5) return '--:--';
    const paceDecimal = 60 / speedKmh;
    const mins = Math.floor(paceDecimal);
    const secs = Math.round((paceDecimal - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const BoatSplitsTable = ({ splits }) => {
    if (!splits || splits.length === 0) return null;
    return (
      <div style={{ marginTop: '15px' }}>
        <div style={sectionTitleStyle}><Activity size={16} /> Tempos por Trecho</div>
        <div style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f1f5f9' }}>
              <tr>
                <th style={{ padding: '8px', textAlign: 'left' }}>Trecho</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Tempo</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Início</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((s) => {
                const start = new Date(s.start_time);
                const end = s.end_time ? new Date(s.end_time) : new Date();
                const durationMs = end - start;
                const hours = Math.floor(durationMs / 3600000);
                const mins = Math.floor((durationMs % 3600000) / 60000);
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px' }}>T{s.exchange_index + 1}</td>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{hours > 0 ? `${hours}h ` : ''}{mins}min</td>
                    <td style={{ padding: '8px', color: '#64748b' }}>{start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
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

      <BoatSplitsTable splits={boatSplits} />

      <div style={{ marginBottom: '15px', marginTop: '15px' }}>
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
            <h2 style={{ margin: '0 0 15px 0', display: 'flex', alignItems: 'center', gap: '10px' }}><Trophy color="#f59e0b" /> Classificação</h2>
            
            {/* Filtros de Categoria Dinâmicos */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '15px', marginBottom: '15px', borderBottom: '1px solid #e2e8f0' }}>
              {['Geral', ...Object.values(BOAT_CATEGORIES).flat()].map(cat => (
                <button 
                  key={cat} 
                  onClick={() => setActiveRankingCategory(cat)}
                  style={{ 
                    padding: '8px 16px', borderRadius: '20px', border: 'none', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 'bold',
                    background: activeRankingCategory === cat ? '#1e3a8a' : '#f1f5f9',
                    color: activeRankingCategory === cat ? '#fff' : '#64748b'
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(() => {
                const filteredBoats = boats
                  .filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory)
                  .sort((a, b) => (b.distance || 0) - (a.distance || 0));
                
                const leaderDistance = filteredBoats[0]?.distance || 0;

                return filteredBoats.map((b, i) => {
                  const diff = (currentTime - new Date(b.last_updated).getTime()) / 60000;
                  const isOnline = b.lat && b.lng && diff < 5;
                  const gap = leaderDistance - (b.distance || 0);

                  return (
                    <div key={b.id} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }} style={{ background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', border: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: '20px', fontWeight: '900', color: i < 3 ? '#f59e0b' : '#94a3b8', width: '30px' }}>{i + 1}º</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color }} />
                          {b.name}
                          {isOnline && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>@{b.nickname} • {b.category}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1e3a8a' }}>{b.distance?.toFixed(2) || '0.00'} <span style={{ fontSize: '10px' }}>km</span></div>
                        {gap > 0 && <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 'bold' }}>-{gap.toFixed(2)} km</div>}
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{calculatePace(b.speed)} min/km</div>
                      </div>
                    </div>
                  );
                });
              })()}
              {boats.filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory).length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Nenhum barco nesta categoria.</div>
              )}
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
                              setEditingBoatId(b.id); setBoatName(b.name); setNickname(b.nickname); setPin(b.pin); setAthletes(b.athletes || []); setExchanges(b.exchanges || []); setBoatType(b.type); setBoatColor(b.color || '#2563eb'); setBoatCategory(b.category || 'Geral'); setIsRegistering(true);
                            } else if (p !== null) alert('SENHA incorreta!');
                          }} style={{ background: '#f1f5f9', border: 'none', padding: '10px 15px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold' }}>Gerenciar</button>                        </div>
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
                    <label style={labelStyle}>CATEGORIA DE DISPUTA</label>
                    <select style={inputStyle} onChange={(e) => setBoatCategory(e.target.value)} value={boatCategory}>
                      <option value="Geral">Geral (Todas)</option>
                      {Object.keys(BOAT_CATEGORIES).map(cat => (
                        <optgroup key={cat} label={cat}>
                          {BOAT_CATEGORIES[cat].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Tipo de Barco</label>
                    <select style={inputStyle} onChange={(e) => setBoatType(e.target.value)} value={boatType}>
                      <option value="">Selecione...</option>
                      {Object.values(BOAT_CATEGORIES).flat().map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
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
                    const payload = { name: boatName, type: boatType, nickname, pin, color: boatColor, category: boatCategory, athletes, exchanges };
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
          <div style={{ display: 'flex', flex: 1, flexDirection: isLandscape ? 'row' : 'column', overflow: 'hidden' }}>
            <div style={{ flex: selectedMapBoatId ? (isLandscape ? '1 1 70%' : '0 0 55%') : '1 1 100%', transition: 'all 0.3s ease', position: 'relative' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <LayersControl position="topright">
                  <BaseLayer checked name="Ruas">
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  </BaseLayer>
                  <BaseLayer name="Satélite">
                    <TileLayer 
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
                    />
                  </BaseLayer>
                </LayersControl>
                <RaceClock startTime={raceStartTime} />
                <MapEventHandler onMapClick={() => setSelectedMapBoatId(null)} />
                
                {/* Botões de Controle do Mapa */}
                <div style={{ position: 'absolute', top: '70px', right: '10px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button onClick={() => { setSelectedMapBoatId(null); }} style={{ ...navBtnStyle, background: 'white', color: '#1e3a8a', width: '40px', height: '40px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', padding: 0, justifyContent: 'center' }}>
                    <MapIcon size={20} />
                  </button>
                  {isTracking && (
                    <button onClick={() => { setSelectedMapBoatId(trackingBoatId); }} style={{ ...navBtnStyle, background: 'white', color: '#10b981', width: '40px', height: '40px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', padding: 0, justifyContent: 'center' }}>
                      <Anchor size={20} />
                    </button>
                  )}
                </div>

                <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={isTracking ? trackingBoatId : null} />
                <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} setClusterModalBoats={setClusterModalBoats} currentTime={currentTime} />
              </MapContainer>
            </div>
            {selectedMapBoatId && boats.find(b => Number(b.id) === Number(selectedMapBoatId)) && (
              <div style={{ 
                flex: isLandscape ? '0 0 350px' : '0 0 45%', 
                background: 'white', 
                borderLeft: isLandscape ? '2px solid #e2e8f0' : 'none', 
                borderTop: isLandscape ? 'none' : '2px solid #e2e8f0',
                height: '100%',
                overflow: 'hidden',
                display: 'flex'
              }}>
                <BoatDetails boat={boats.find(b => Number(b.id) === Number(selectedMapBoatId))} onClose={() => setSelectedMapBoatId(null)} />
              </div>
            )}
          </div>
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
                        await axios.post(`${API_URL}/api/boats/${trackingBoatId}/take_control`, { 
                          new_crew: selectedCrew,
                          exchange_index: selectedExchangeIndex 
                        });
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
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={async () => {
                          const currentBoat = boats.find(b => Number(b.id) === Number(trackingBoatId));
                          const newSosStatus = !currentBoat?.sos_active;
                          await axios.post(`${API_URL}/api/boats/${trackingBoatId}/sos`, { active: newSosStatus });
                        }} 
                        style={{ background: boats.find(b => Number(b.id) === Number(trackingBoatId))?.sos_active ? '#fff' : '#ef4444', color: boats.find(b => Number(b.id) === Number(trackingBoatId))?.sos_active ? '#ef4444' : '#fff', border: '2px solid #ef4444', padding: '8px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '14px', animation: boats.find(b => Number(b.id) === Number(trackingBoatId))?.sos_active ? 'pulse 0.5s infinite' : 'none' }}
                      >
                        {boats.find(b => Number(b.id) === Number(trackingBoatId))?.sos_active ? 'CANCELAR SOS' : '🚨 SOS'}
                      </button>
                      <button onClick={() => stopTracking()} style={{ background: '#475569', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '10px', fontWeight: 'bold' }}>PARAR</button>
                    </div>
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

                  {gpsAccuracy && (
                    <div style={{ fontSize: '10px', color: gpsAccuracy > 30 ? '#ef4444' : '#64748b', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold' }}>
                      📡 Precisão do GPS: {Math.round(gpsAccuracy)}m 
                      {gpsAccuracy > 30 ? ' (Sinal Fraco)' : ' (Sinal Forte)'}
                    </div>
                  )}

                  <div style={{ background: 'rgba(16,185,129,0.1)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ fontSize: '11px', color: '#065f46', fontWeight: 'bold', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Users size={14}/> EQUIPE NO TRECHO {selectedExchangeIndex + 1}:
                    </div>
                    <div style={{ fontSize: '13px', color: '#047857' }}>
                      {exchanges[selectedExchangeIndex]?.join(', ') || 'Nuehum atleta escalado'}
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', flex: 1, flexDirection: isLandscape ? 'row' : 'column', overflow: 'hidden' }}>
                  <div style={{ flex: selectedMapBoatId ? (isLandscape ? '1 1 70%' : '0 0 55%') : '1 1 100%', position: 'relative', transition: 'all 0.3s ease' }}>
                    <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                      <LayersControl position="topright">
                        <BaseLayer checked name="Ruas">
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        </BaseLayer>
                        <BaseLayer name="Satélite">
                          <TileLayer 
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
                          />
                        </BaseLayer>
                      </LayersControl>
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
                        {!isSocketConnected ? '⚠️ Offline - Salvando no celular' :
                        syncStatus === 'sending' ? '📡 Sincronizando agora...' : 
                        syncStatus === 'error' ? '⚠️ Erro de GPS' :
                        syncStatus === 'ok' ? '✅ Sincronizado agora!' :
                        nextSyncCountdown > 0 ? `Próxima sincronização em ${nextSyncCountdown}s` :
                        'Aguardando sinal GPS...'}
                      </span>
                    </div>
                  </div>
                  {selectedMapBoatId && boats.find(b => Number(b.id) === Number(selectedMapBoatId)) && (
                    <div style={{ 
                      flex: isLandscape ? '0 0 350px' : '0 0 45%', 
                      background: 'white', 
                      borderLeft: isLandscape ? '2px solid #e2e8f0' : 'none', 
                      borderTop: isLandscape ? 'none' : '2px solid #e2e8f0',
                      height: '100%',
                      overflow: 'hidden',
                      display: 'flex'
                    }}>
                      <BoatDetails boat={boats.find(b => Number(b.id) === Number(selectedMapBoatId))} onClose={() => setSelectedMapBoatId(null)} />
                    </div>
                  )}
                </div>
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
              <label style={labelStyle}>Controle da Prova</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!raceStartTime ? (
                  <button 
                    onClick={() => { if (window.confirm('Iniciar o cronômetro da prova para TODOS?')) axios.post(`${API_URL}/api/config`, { raceStartTime: Date.now() }); }} 
                    style={{ ...startBtnStyle, background: '#10b981', flex: 1 }}
                  >
                    Iniciar Prova
                  </button>
                ) : (
                  <button 
                    onClick={() => { if (window.confirm('Resetar o cronômetro da prova?')) axios.post(`${API_URL}/api/config`, { raceStartTime: null }); }} 
                    style={{ ...startBtnStyle, background: '#ef4444', flex: 1 }}
                  >
                    Resetar Cronômetro
                  </button>
                  </div>
                  <button 
                  onClick={async () => { 
                    if (window.confirm('CUIDADO! Isso vai ZERAR TODOS os barcos, apagar todos os rastros e tempos de trecho. Tem certeza absoluta?')) {
                      await axios.post(`${API_URL}/api/admin/reset_all`);
                      fetchBoats();
                    }
                  }} 
                  style={{ ...startBtnStyle, background: '#000', marginTop: '10px' }}
                  >
                  Limpeza Total (Reset Geral)
                  </button>
                  </div>
            </div>

            <div style={{ background: 'white', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
              <label style={labelStyle}>Intervalo de GPS (Global)</label>
              <select value={relayTimeout} onChange={(e) => axios.post(`${API_URL}/api/config`, { relayTimeout: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }}>
                {[1,2,3,4,5,10].map(n => <option key={n} value={n}>Relay GPS: {n} min</option>)}
              </select>
            </div>

            <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Monitoramento de Telemetria ({boats.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {boats.map(b => {
                const diff = (currentTime - new Date(b.last_updated).getTime()) / 60000;
                const status = diff < 5 ? 'online' : (diff < 15 ? 'warning' : 'lost');
                const statusLabel = status === 'online' ? 'Ativo' : (status === 'warning' ? 'Sinal Instável' : 'SINAL PERDIDO');
                const statusColor = status === 'online' ? '#10b981' : (status === 'warning' ? '#f59e0b' : '#ef4444');

                return (
                  <div key={b.id} style={{ background: 'white', padding: '15px', borderRadius: '15px', border: `2px solid ${statusColor}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color }} />
                          <strong style={{ fontSize: '16px' }}>{b.name}</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>@{b.nickname} • {b.category}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: statusColor, textTransform: 'uppercase' }}>{statusLabel}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>há {Math.floor(diff)} min</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase' }}>Bateria</div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: (b.battery_level || 0) < 20 ? '#ef4444' : '#1e293b' }}>
                          <Battery size={12} style={{ verticalAlign: 'middle', marginRight: '2px' }} /> {b.battery_level || '--'}%
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase' }}>Precisão</div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: (b.heading === null) ? '#ef4444' : '#1e293b' }}>
                          {b.distance?.toFixed(1)}km
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase' }}>Ações</div>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                          <RefreshCw size={16} color="#f59e0b" onClick={() => { if (window.confirm('Resetar barco?')) axios.post(`${API_URL}/api/boats/${b.id}/reset`).then(() => fetchBoats()); }} style={{ cursor: 'pointer' }} />
                          <Trash2 size={16} color="#ef4444" onClick={() => { if (window.confirm('Remover barco?')) axios.delete(`${API_URL}/api/boats/${b.id}`).then(() => fetchBoats()); }} style={{ cursor: 'pointer' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
