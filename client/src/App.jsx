import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, LayersControl } from 'react-leaflet';
const { BaseLayer } = LayersControl;
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Play, RefreshCw, Ship, Anchor, Users, Navigation, Activity, LogOut, AlertTriangle, Trash2, UserMinus, X, Battery, Trophy, Download, Search } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings';

// --- CONFIGURAÇÕES ---
const isApp = Capacitor.isNativePlatform();
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = isApp ? BACKEND_URL : ((window.location.hostname === 'localhost') ? 'http://localhost:3001' : BACKEND_URL);
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

function BoatLayer({ boats, trackingBoatId, setSelectedMapBoatId, setClusterModalBoats, currentTime, categoryFilter = 'Geral', searchQuery = '' }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const groups = [];
  const processedIds = new Set();
  
  const filtered = (boats || []).filter(b => {
    const matchesCategory = categoryFilter === 'Geral' || b.category === categoryFilter;
    const matchesSearch = !searchQuery || 
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (b.nickname && b.nickname.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const active = filtered.filter(b => b.lat && b.lng && (currentTime - new Date(b.last_updated).getTime()) < 3600000);
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

  const categoryLeaders = {};
  (boats || []).forEach(b => {
    if (!categoryLeaders[b.category] || (b.distance > (categoryLeaders[b.category].distance || 0))) {
      categoryLeaders[b.category] = b;
    }
  });

  return (
    <>
      {(active || []).map(b => (
        <React.Fragment key={`frag-${b.id}`}>
          {b.trail && Array.isArray(b.trail) && b.trail.length > 1 && (
            <Polyline 
              key={`trail-${b.id}`} 
              positions={b.trail.map(t => [t.lat, t.lng])} 
              pathOptions={{ color: b.color || '#2563eb', weight: 3, opacity: 0.6, dashArray: '5, 10' }} 
            />
          )}
          {/* Se o barco não estiver num grupo de 1, o Marker é desenhado pelo map de grupos abaixo */}
        </React.Fragment>
      ))}
      {(groups || []).map(group => {
        const { anchor, members } = group;
        if (members.length === 1) {
          const boat = members[0];
          const diff = (currentTime - new Date(boat.last_updated).getTime()) / 60000;
          const status = diff < 5 ? 'online' : (diff < 10 ? 'warning' : 'lost');
          const isLeader = categoryLeaders[boat.category]?.id === boat.id && boat.distance > 0;
          
          return (
            <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.name, status, Number(boat.id) === Number(trackingBoatId), boat.color, boat.heading, boat.sos_active, isLeader)} eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }} />
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

  useEffect(() => {
    setIsFollowing(true);
    const timer = setTimeout(() => { map.invalidateSize({ animate: true }); }, 300);
    return () => clearTimeout(timer);
  }, [selectedMapBoatId, focusBoatId, map]);

  useEffect(() => {
    const focusId = focusBoatId || selectedMapBoatId;
    if (focusId && isFollowing) {
      const b = (boats || []).find(x => Number(x.id) === Number(focusId));
      if (b && b.lat && b.lng) {
        map.setView([b.lat, b.lng], 16, { animate: true });
      }
    } else if (!focusId) {
      const activeBoats = (boats || []).filter(b => b.lat && b.lng);
      if (activeBoats.length > 0) {
        const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
      }
    }
  }, [boats, map, selectedMapBoatId, focusBoatId, isFollowing]);

  useMapEvents({
    dragstart: () => { if (selectedMapBoatId || focusBoatId) setIsFollowing(false); }
  });

  return null;
}

function MapEventHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => {
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

function BroadcastBar({ broadcast }) {
  if (!broadcast || !broadcast.message) return null;
  return (
    <div style={{ background: '#ef4444', color: 'white', padding: '10px 15px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 2px 10px rgba(239,68,68,0.3)', zIndex: 1100 }}>
      <AlertTriangle size={18} />
      <div style={{ flex: 1, fontSize: '13px', fontWeight: 'bold' }}>
        <marquee scrollamount="5">{broadcast.message}</marquee>
      </div>
      <div style={{ fontSize: '10px', opacity: 0.8 }}>
        {new Date(broadcast.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}

function MapWaypoints({ waypoints, isAdmin, onAddWaypoint, onDeleteWaypoint }) {
  return (
    <>
      {(waypoints || []).map(wp => (
        <Marker 
          key={wp.id} 
          position={[wp.lat, wp.lng]} 
          icon={L.divIcon({
            html: `<div style="background: white; border: 2px solid #1e3a8a; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; color: #1e3a8a; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${wp.name}</div>`,
            className: '', iconSize: [24, 24], iconAnchor: [12, 12]
          })}
        >
          {isAdmin && (
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <strong>{wp.name}</strong><br/>
                <button 
                  onClick={() => onDeleteWaypoint(wp.id)}
                  style={{ background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '5px', marginTop: '10px', fontSize: '10px' }}
                >
                  Excluir Ponto
                </button>
              </div>
            </Popup>
          )}
        </Marker>
      ))}
    </>
  );
}

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem('vtl_view') || 'map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [clusterModalBoats, setClusterModalBoats] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [mapCategoryFilter, setMapCategoryFilter] = useState('Geral');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [boatName, setBoatName] = useState('');
  const [boatType, setBoatType] = useState('');
  const [boatColor, setBoatColor] = useState('#2563eb');
  const [boatCategory, setBoatCategory] = useState('Geral');
  const [nickname, setNickname] = useState('');
  const [athletes, setAthletes] = useState([]);
  const [exchanges, setExchanges] = useState([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [editingBoatId, setEditingBoatId] = useState(null);
  const [boatSplits, setBoatSplits] = useState([]);
  const [crewInput, setCrewInput] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vtl_admin') === 'true');
  const [activeRankingCategory, setActiveRankingCategory] = useState('Geral');
  const [raceStartTime, setRaceStartTime] = useState(null);
  const [broadcast, setBroadcast] = useState({ message: '', timestamp: null });
  const [broadcastInput, setBroadcastInput] = useState('');
  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [nextSyncCountdown, setNextSyncCountdown] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const isTrackingRef = useRef(false);
  const trackingBoatIdRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight || window.innerWidth > 768);
  const relayTimeoutRef = useRef(1);
  const [relayTimeout, setRelayTimeout] = useState(1);
  const wakeLockRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => { localStorage.setItem('vtl_view', view); }, [view]);

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
    const onConnect = () => setIsSocketConnected(true);
    const onDisconnect = () => setIsSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, []);

  useEffect(() => {
    if (isSocketConnected && isTracking) {
      const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
      if (buffer.length > 0) {
        buffer.forEach(data => socket.emit('update_location', data));
        localStorage.removeItem('vtl_gps_buffer');
      }
    }
  }, [isSocketConnected, isTracking]);

  useEffect(() => {
    const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight || window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isTracking) { setNextSyncCountdown(0); return; }
    const interval = setInterval(() => {
      const now = Date.now();
      const nextSync = lastSentRef.current + (relayTimeoutRef.current * 60000);
      const remaining = Math.max(0, Math.ceil((nextSync - now) / 1000));
      setNextSyncCountdown(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [isTracking]);

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
    const handlePermissions = async () => {
      if (isApp) {
        try {
          try {
            const info = await Device.getBatteryInfo();
            const level = Math.round(info.batteryLevel * 100);
            const savedId = trackingBoatIdRef.current || localStorage.getItem('vtl_boat_id');
            if (savedId) socket.emit('update_location', { boatId: savedId, batteryLevel: level });
          } catch (e) {}

          const check = await Geolocation.checkPermissions();
          if (check.location !== 'granted') {
            const status = await Geolocation.requestPermissions();
            if (status.location === 'granted') {
              alert('GPS Ativo! Agora você será levado às configurações para ativar o modo "Sempre Permitir" (rastreio com tela bloqueada).');
              await NativeSettings.open({ optionAndroid: AndroidSettings.Location, optionIOS: IOSSettings.App });
            } else {
              alert('O App precisa de permissão de GPS para funcionar! Por favor, habilite nas configurações.');
              await NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App });
            }
          }
        } catch (err) { console.error('Erro permissões:', err); }
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(() => {}, () => {});
      }
    };
    handlePermissions();
    fetchBoats();
    fetchWaypoints();
    socket.on('config_updated', (data) => { 
      setRelayTimeout(data.relayTimeout); 
      relayTimeoutRef.current = data.relayTimeout; 
      setRaceStartTime(data.raceStartTime);
      if (data.lastBroadcast) setBroadcast(data.lastBroadcast);
    });
    socket.on('broadcast_received', (data) => { setBroadcast(data); });
    socket.on('waypoints_updated', () => fetchWaypoints());
    socket.on('waypoints_deleted', () => fetchWaypoints());
    socket.on('sos_alert', (data) => { alert(`🚨 EMERGÊNCIA: O barco ${data.boatName} ativou o SOS!`); });
    socket.on('location_changed', (data) => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(data.boatId)) {
        setLastSuccessfulUpdate(Date.now());
        setSyncStatus('ok');
        setTimeout(() => { if (isTrackingRef.current) setSyncStatus('idle'); }, 3000);
      }
      setBoats(prev => {
        const list = Array.isArray(prev) ? prev : [];
        if (!list.find(b => Number(b.id) === Number(data.boatId))) { fetchBoats(); return list; }
        return list.map(b => {
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
        const list = Array.isArray(prev) ? prev : [];
        if (list.find(b => Number(b.id) === Number(updatedBoat.id))) return list.map(b => Number(b.id) === Number(updatedBoat.id) ? { ...b, ...updatedBoat } : b);
        return [...list, updatedBoat];
      });
    });
    socket.on('boat_deleted', (data) => {
      setBoats(prev => (Array.isArray(prev) ? prev : []).filter(b => Number(b.id) !== Number(data.id)));
      if (Number(selectedMapBoatId) === Number(data.id)) setSelectedMapBoatId(null);
    });
    socket.on('control_taken', (data) => { if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(data.boatId)) { alert("Controle assumido!"); stopTracking(true); } });
    return () => { socket.off('config_updated'); socket.off('location_changed'); socket.off('boat_updated'); socket.off('boat_deleted'); socket.off('control_taken'); };
  }, []);

  useEffect(() => {
    if (trackingBoatId && boats.length > 0 && !isTracking) {
      const b = boats.find(x => Number(x.id) === Number(trackingBoatId));
      if (b) {
        setBoatName(b.name); setBoatType(b.type); setNickname(b.nickname);
        setIsTracking(true); isTrackingRef.current = true; trackingBoatIdRef.current = b.id;
        if ('wakeLock' in navigator) { navigator.wakeLock.request('screen').then(lock => { wakeLockRef.current = lock; }).catch(() => {}); }
        trackLocation(b.id);
      }
    }
  }, [boats, trackingBoatId]);

  const fetchBoats = async () => { try { const res = await axios.get(`${API_URL}/api/boats`); setBoats(Array.isArray(res.data) ? res.data : []); } catch (err) { console.error('Erro API:', err); } };
  const fetchWaypoints = async () => { try { const res = await axios.get(`${API_URL}/api/waypoints`); setWaypoints(Array.isArray(res.data) ? res.data : []); } catch (err) { console.error('Erro Waypoints:', err); } };

  const startTracking = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      audio.loop = true; audio.play().catch(() => {});
      audioRef.current = audio; 
      setTrackingBoatId(id); trackingBoatIdRef.current = id;
      setIsTracking(true); isTrackingRef.current = true;
      localStorage.setItem('vtl_tracking_id', id);
      trackLocation(id);
    } catch (err) { alert('Erro ao iniciar GPS.'); }
  };

  const stopTracking = (forceMap = false) => {
    setIsTracking(false); isTrackingRef.current = false; setTrackingBoatId(null); trackingBoatIdRef.current = null;
    localStorage.removeItem('vtl_tracking_id'); setSyncStatus('idle');
    if (watchIdRef.current) { if (isApp) Geolocation.clearWatch({ id: watchIdRef.current }); else navigator.geolocation.clearWatch(watchIdRef.current); }
    if (wakeLockRef.current) wakeLockRef.current.release();
    if (audioRef.current) audioRef.current.pause();
    if (forceMap) setView('map'); else window.location.reload();
  };

  const trackLocation = (id) => {
    if (!isTrackingRef.current) return;
    if (isApp) {
      const startNativeTracking = async () => {
        const watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000 }, async (pos, err) => {
          if (err || !pos || !isTrackingRef.current) return;
          const now = Date.now();
          if (!lastSentRef.current || (now - lastSentRef.current) >= (relayTimeoutRef.current * 60000)) {
            setSyncStatus('sending');
            let batteryLevel = 100;
            try { const info = await Device.getBatteryInfo(); batteryLevel = Math.round(info.batteryLevel * 100); } catch (e) {}
            const payload = { boatId: id, lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading, batteryLevel };
            if (socket.connected) socket.emit('update_location', payload);
            else { 
              const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
              buffer.push(payload); localStorage.setItem('vtl_gps_buffer', JSON.stringify(buffer.slice(-50)));
            }
            setGpsAccuracy(pos.coords.accuracy); lastSentRef.current = now;
          }
        });
        watchIdRef.current = watchId;
      };
      startNativeTracking();
    } else {
      if (!navigator.geolocation) return;
      const watchId = navigator.geolocation.watchPosition(async (pos) => {
        if (!isTrackingRef.current) return;
        const now = Date.now();
        if (!lastSentRef.current || (now - lastSentRef.current) >= (relayTimeoutRef.current * 60000)) {
          setSyncStatus('sending');
          let batteryLevel = 100;
          try { if ('getBattery' in navigator) { const b = await navigator.getBattery(); batteryLevel = Math.round(b.level * 100); } } catch (e) {}
          const payload = { boatId: id, lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading, batteryLevel };
          if (socket.connected) socket.emit('update_location', payload);
          else {
            const buffer = JSON.parse(localStorage.getItem('vtl_gps_buffer') || '[]');
            buffer.push(payload); localStorage.setItem('vtl_gps_buffer', JSON.stringify(buffer.slice(-50)));
          }
          setGpsAccuracy(pos.coords.accuracy); lastSentRef.current = now;
        }
      }, (err) => { setSyncStatus('error'); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
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

  const BoatDetails = ({ boat, onClose }) => (
    <div style={{ flex: '0 0 45%', background: 'white', borderTop: '2px solid #e2e8f0', padding: '15px 20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>{boat.name}</h2>
        <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }}>Fechar</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '15px' }}>
        <div style={infoCardStyle}><Navigation size={14} color="#059669" /><div><span style={infoLabel}>KM</span><br/><strong>{boat.distance?.toFixed(2) || 0}</strong></div></div>
        <div style={infoCardStyle}><Activity size={14} color="#2563eb" /><div><span style={infoLabel}>Km/h</span><br/><strong>{boat.speed || 0}</strong></div></div>
        <div style={infoCardStyle}><Battery size={14} color="#64748b" /><div><span style={infoLabel}>Bat</span><br/><strong>{boat.battery_level || '--'}%</strong></div></div>
      </div>
      <button onClick={() => { setView('track'); setNickname(boat.nickname || ''); setBoatName(boat.name); setSelectedMapBoatId(null); }} style={{ ...startBtnStyle, background: '#0f172a' }}>Assumir Barco</button>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <BroadcastBar broadcast={broadcast} />
      <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 10px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
        <button onClick={() => { setView('map'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><MapIcon size={22} /> Mapa</button>
        <button onClick={() => { setView('ranking'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Trophy size={22} /> Ranking</button>
        <button onClick={() => { setView('boats'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Ship size={22} /> Equipes</button>
        <button onClick={() => { setView('track'); setSelectedMapBoatId(null); setClusterModalBoats(null); }} style={navBtnStyle}><Play size={22} /> Transmitir</button>
      </nav>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {clusterModalBoats && (
          <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>Barcos nesta área</h3>
                <button onClick={() => setClusterModalBoats(null)} style={{ background: 'none', border: 'none' }}><X size={24} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(clusterModalBoats || []).map(b => (
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
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '15px', marginBottom: '15px', borderBottom: '1px solid #e2e8f0' }}>
              {['Geral', ...Object.values(BOAT_CATEGORIES).flat()].map(cat => (
                <button key={cat} onClick={() => setActiveRankingCategory(cat)} style={{ padding: '8px 16px', borderRadius: '20px', border: 'none', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 'bold', background: activeRankingCategory === cat ? '#1e3a8a' : '#f1f5f9', color: activeRankingCategory === cat ? '#fff' : '#64748b' }}>{cat}</button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(() => {
                const filtered = (boats || []).filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory).sort((a, b) => (b.distance || 0) - (a.distance || 0));
                const topDist = filtered[0]?.distance || 0;
                return (filtered || []).map((b, i) => (
                  <div key={b.id} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }} style={{ background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: i < 3 ? '#f59e0b' : '#94a3b8', width: '30px' }}>{i + 1}º</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color }} />{b.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>ID: {b.nickname?.toUpperCase()} • {b.category}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1e3a8a' }}>{b.distance?.toFixed(2) || '0.00'} <span style={{ fontSize: '10px' }}>km</span></div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{calculatePace(b.speed)} min/km</div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {view === 'boats' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            {!isRegistering ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0 }} onClick={() => { window._adminClick = (window._adminClick || 0) + 1; if (window._adminClick >= 5) { setIsAdmin(true); alert('Admin On'); } }}>Lista de Equipes</h2>
                  {isAdmin && <button onClick={() => { setIsRegistering(true); setEditingBoatId(null); setNickname(''); setBoatName(''); setAthletes([]); setExchanges([]); }} style={{ ...startBtnStyle, width: 'auto', padding: '10px 20px' }}>+ Novo</button>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(boats || []).map(b => {
                    const diff = (currentTime - new Date(b.last_updated).getTime()) / 60000;
                    const isOnline = b.lat && b.lng && diff < 5;
                    return (
                      <div key={b.id} style={{ background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color || '#2563eb' }} />
                          <div>
                            <div style={{ fontWeight: 'bold', color: '#1e3a8a' }}>{b.name} {isOnline && '• LIVE'}</div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>ID: {b.nickname?.toUpperCase()} • {b.category}</div>
                          </div>
                        </div>
                        {isAdmin && <button onClick={() => { setEditingBoatId(b.id); setBoatName(b.name); setNickname(b.nickname); setBoatColor(b.color); setBoatCategory(b.category); setIsRegistering(true); }} style={{ background: '#f1f5f9', border: 'none', padding: '8px 12px', borderRadius: '8px', fontSize: '12px' }}>Editar</button>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ background: 'white', padding: '25px', borderRadius: '25px', maxWidth: '500px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h2 style={{ margin: 0 }}>{editingBoatId ? 'Editar' : 'Novo'}</h2><button onClick={() => setIsRegistering(false)} style={{ border: 'none', background: 'none' }}><X size={24}/></button></div>
                <label style={labelStyle}>ID (Nickname)</label><input value={nickname} onChange={e => setNickname(e.target.value)} style={inputStyle} />
                <label style={labelStyle}>Nome</label><input value={boatName} onChange={e => setBoatName(e.target.value)} style={inputStyle} />
                <button onClick={async () => {
                  try {
                    const payload = { name: boatName, nickname: nickname.toLowerCase().trim(), color: boatColor, category: boatCategory, pin: '1234' };
                    if (editingBoatId) await axios.put(`${API_URL}/api/boats/${editingBoatId}`, payload);
                    else await axios.post(`${API_URL}/api/boats`, payload);
                    setIsRegistering(false); fetchBoats();
                  } catch (err) { alert('Erro ao salvar'); }
                }} style={startBtnStyle}>Salvar</button>
              </div>
            )}
          </div>
        )}

        {view === 'map' && (
          <div style={{ display: 'flex', flex: 1, flexDirection: isLandscape ? 'row' : 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <LayersControl position="topright">
                  <BaseLayer checked name="Ruas"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /></BaseLayer>
                  <BaseLayer name="Satélite"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /></BaseLayer>
                </LayersControl>
                <RaceClock startTime={raceStartTime} />
                <MapEventHandler onMapClick={() => setSelectedMapBoatId(null)} />
                <MapWaypoints waypoints={waypoints} isAdmin={isAdmin} onAddWaypoint={(wp) => axios.post(`${API_URL}/api/waypoints`, wp)} onDeleteWaypoint={(id) => axios.delete(`${API_URL}/api/waypoints/${id}`)} />
                <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={isTracking ? trackingBoatId : null} />
                <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} setClusterModalBoats={setClusterModalBoats} currentTime={currentTime} categoryFilter={mapCategoryFilter} searchQuery={mapSearchQuery} />
              </MapContainer>
              <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1000, width: isLandscape ? '250px' : 'calc(100% - 60px)' }}>
                <input placeholder="Buscar equipe..." value={mapSearchQuery} onChange={e => setMapSearchQuery(e.target.value)} style={{ ...inputStyle, background: 'white', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', height: '40px' }} />
              </div>
            </div>
            {selectedMapBoatId && <BoatDetails boat={(boats || []).find(b => Number(b.id) === Number(selectedMapBoatId))} onClose={() => setSelectedMapBoatId(null)} />}
          </div>
        )}

        {view === 'track' && (
          <div style={{ padding: '30px 20px', overflowY: 'auto', height: '100%' }}>
            {!isTracking ? (
              <div style={{ background: 'white', padding: '25px', borderRadius: '25px', maxWidth: '500px', margin: '0 auto', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
                <h2 style={{ margin: '0 0 20px 0' }}>Acesso ao Barco</h2>
                <label style={labelStyle}>ID da Equipe</label>
                <input placeholder="Ex: BRA316" value={nickname} onChange={e => setNickname(e.target.value)} style={inputStyle} />
                <button onClick={async () => {
                  const nick = nickname.trim().toLowerCase();
                  if (!nick) return alert('Digite o ID!');
                  try {
                    const res = await axios.post(`${API_URL}/api/boats/auth`, { nickname: nick });
                    setBoatName(res.data.name); setTrackingBoatId(res.data.id); trackingBoatIdRef.current = res.data.id;
                    localStorage.setItem('vtl_boat_id', res.data.id);
                    axios.post(`${API_URL}/api/boats/${res.data.id}/take_control`, { new_crew: [] });
                  } catch (err) { alert('Equipe não encontrada'); }
                }} style={startBtnStyle}>Entrar</button>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div style={{ background: '#ecfdf5', padding: '20px', borderRadius: '20px', marginBottom: '20px', border: '2px solid #10b981' }}>
                  <div style={{ color: '#059669', fontWeight: 'bold' }}>📡 TRANSMITINDO</div>
                  <h2 style={{ margin: '5px 0' }}>{boatName}</h2>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', margin: '15px 0' }}>{syncStatus === 'sending' ? 'Sincronizando...' : (nextSyncCountdown > 0 ? `Próximo em ${nextSyncCountdown}s` : 'Aguardando GPS...')}</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>
                    <div><div style={infoLabel}>Km</div><strong>{boats.find(b => Number(b.id) === Number(trackingBoatId))?.distance?.toFixed(2) || '0.00'}</strong></div>
                    <div><div style={infoLabel}>Bat</div><strong>{boats.find(b => Number(b.id) === Number(trackingBoatId))?.battery_level || '--'}%</strong></div>
                  </div>
                </div>
                <button onClick={() => stopTracking()} style={{ ...startBtnStyle, background: '#ef4444' }}>PARAR TRANSMISSÃO</button>
                <p style={{ marginTop: '20px', fontSize: '12px', color: '#64748b' }}>Mantenha o app aberto e a tela ligada para melhor precisão.</p>
              </div>
            )}
          </div>
        )}

        {view === 'admin' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            <h2>Admin</h2>
            <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: Date.now() })} style={{ ...startBtnStyle, background: '#10b981', marginBottom: '10px' }}>Iniciar Prova</button>
            <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: null })} style={{ ...startBtnStyle, background: '#ef4444', marginBottom: '10px' }}>Resetar Tempo</button>
            <button onClick={() => { window.open(`${API_URL}/api/admin/export`, '_blank'); }} style={startBtnStyle}>Exportar CSV</button>
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
const modalOverlayStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const modalContentStyle = { background: 'white', borderRadius: '20px', padding: '20px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' };
const modalButtonStyle = { background: '#f1f5f9', border: 'none', padding: '15px', borderRadius: '12px', textAlign: 'left', fontSize: '16px', cursor: 'pointer', color: '#1e3a8a' };
