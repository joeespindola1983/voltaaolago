import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Trophy, Ship, Play, Download, X, Battery, LogOut, Activity, Navigation, Timer, Maximize, Search, ChevronRight, WifiOff, Clock, Sun, Settings, ArrowRight } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings';

import 'leaflet/dist/leaflet.css';

// --- 1. CONFIGURAÇÕES ---
const isApp = Capacitor.isNativePlatform();
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = BACKEND_URL; 
const socket = io(API_URL);
const VERSION = "v2.8.0 (Tactical Refined)";
const CATEGORIES = ['Geral', 'Estreante', 'Open', '40+', '50+', '60/70+'];
const CLIENT_ID = Math.random().toString(36).substring(7);

// --- 2. ESTILOS ---
const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '10px', gap: '2px' };
const btnStyle = { width: '100%', padding: '16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', boxSizing: 'border-box' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', boxSizing: 'border-box' };
const rankCardStyle = { background: 'white', padding: '15px', borderRadius: '15px', display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px', border: '1px solid #f1f5f9', cursor: 'pointer' };
const catBtnStyle = { padding: '8px 15px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap', cursor: 'pointer' };
const floatingBtnStyle = { background: 'white', border: 'none', borderRadius: '12px', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', color: '#1e3a8a', cursor: 'pointer', pointerEvents: 'auto' };
const smallTelemetryStyle = { background: '#f8fafc', padding: '8px 5px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid #e2e8f0', fontSize: '13px' };
const modalOverlayStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const modalContentStyle = { background: 'white', borderRadius: '20px', padding: '20px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' };
const modalButtonStyle = { background: '#f1f5f9', border: 'none', padding: '15px', borderRadius: '12px', textAlign: 'left', fontSize: '16px', cursor: 'pointer', color: '#1e3a8a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

// --- 3. FUNÇÕES UTILITÁRIAS ---
const calculatePace = (speedKmh) => {
  if (!speedKmh || speedKmh < 0.5) return '--:--';
  const paceDecimal = 60 / speedKmh;
  const mins = Math.floor(paceDecimal);
  const secs = Math.round((paceDecimal - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const boatIcon = (name, isSelected = false, color = '#2563eb', heading = 0, isLeader = false) => {
  const size = 42;
  const bgColor = isSelected ? '#10b981' : color;
  return L.divIcon({
    html: `<div style="display: flex; flex-direction: column; align-items: center; width: 100px;">
            <div style="background-color: ${bgColor}; border-radius: 50%; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border: 3px solid ${isLeader ? '#f59e0b' : 'white'}; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: all 0.3s ease; transform: rotate(${heading}deg); ${isSelected ? 'outline: 3px solid #10b981; outline-offset: 2px;' : ''}">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/></svg>
            </div>
            <div style="background: rgba(255,255,255,0.9); color: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 6px; border: 1px solid #cbd5e1; white-space: nowrap;">${name}</div>
           </div>`,
    className: '', iconSize: [100, 70], iconAnchor: [50, 21]
  });
};

const clusterIcon = (count) => L.divIcon({
  html: `<div style="background-color: #1e3a8a; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: white; fontWeight: bold; font-size: 16px;">${count}</div>`,
  className: '', iconSize: [44, 44], iconAnchor: [22, 22]
});

// --- 4. COMPONENTES ---

function SlideToStop({ onStop }) {
  const [sliderPos, setSliderPos] = useState(0);
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const handleStart = () => { isDragging.current = true; };
  const handleMove = (e) => {
    if (!isDragging.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = containerRef.current.getBoundingClientRect();
    let pos = ((clientX - rect.left - 25) / (rect.width - 60)) * 100;
    pos = Math.max(0, Math.min(100, pos));
    setSliderPos(pos);
    if (pos >= 95) { isDragging.current = false; onStop(); }
  };
  const handleEnd = () => { if (sliderPos < 95) { setSliderPos(0); isDragging.current = false; } };
  return (
    <div ref={containerRef} onMouseMove={handleMove} onTouchMove={handleMove} onMouseUp={handleEnd} onTouchEnd={handleEnd} onMouseLeave={handleEnd} style={{ width: '100%', height: '64px', background: '#fee2e2', borderRadius: '32px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #ef4444', touchAction: 'none' }}>
      <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '14px', opacity: 1 - (sliderPos/100), transition: 'opacity 0.1s' }}>DESLIZE PARA PARAR</div>
      <div onMouseDown={handleStart} onTouchStart={handleStart} style={{ position: 'absolute', left: `calc(${sliderPos}% + 5px)`, top: '5px', width: '54px', height: '54px', background: '#ef4444', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: '0 4px 10px rgba(239,68,68,0.4)', cursor: 'grab', transition: isDragging.current ? 'none' : 'left 0.3s' }}><ArrowRight size={24} /></div>
    </div>
  );
}

function BoatCard({ boat, isTracking, onClose }) {
  const [showStatusLabel, setShowStatusLabel] = useState(false);
  const labelTimeoutRef = useRef(null);
  if (!boat) return null;
  const pace = calculatePace(boat.speed);
  const diffMinutes = (Date.now() - new Date(boat.last_updated).getTime()) / 60000;
  let statusColor = '#10b981'; 
  let statusLabel = 'Sinal OK';
  if (diffMinutes >= 30) { statusColor = '#ef4444'; statusLabel = 'Offline'; }
  else if (diffMinutes >= 10) { statusColor = '#f59e0b'; statusLabel = 'Atenção'; }
  const lastUpdateText = boat.last_updated ? (diffMinutes < 1 ? 'agora' : `há ${Math.floor(diffMinutes)}m`) : 'nunca';
  const handleLedClick = () => {
    setShowStatusLabel(true);
    if (labelTimeoutRef.current) clearTimeout(labelTimeoutRef.current);
    labelTimeoutRef.current = setTimeout(() => setShowStatusLabel(false), 5000);
  };
  return (
    <div style={{ background: 'rgba(255,255,255,0.98)', padding: '12px', borderRadius: '16px', border: `2px solid ${isTracking ? '#10b981' : '#1e3a8a'}`, boxShadow: '0 8px 25px rgba(0,0,0,0.15)', width: '280px', pointerEvents: 'auto', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '-10px', right: '40px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', zIndex: 100 }}>
        <div onClick={handleLedClick} style={{ width: '16px', height: '16px', borderRadius: '50%', background: statusColor, border: '2px solid white', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', cursor: 'pointer', animation: diffMinutes < 10 ? 'pulse 2s infinite' : 'none' }} />
        {showStatusLabel && <div style={{ background: '#1e293b', color: 'white', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', marginTop: '5px', whiteSpace: 'nowrap', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>{statusLabel} • {lastUpdateText}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: boat.color || '#2563eb' }} /><strong style={{ fontSize: '15px', color: '#1e3a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{boat.name}</strong></div>
          <div style={{ fontSize: '10px', color: '#64748b' }}>ID: {boat.nickname?.toUpperCase()} • {boat.category}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px', color: boat.battery_level < 20 ? '#ef4444' : '#64748b' }}><Battery size={12}/> {boat.battery_level || '--'}%</div>
          {onClose && <X size={18} onClick={onClose} style={{ cursor: 'pointer', color: '#94a3b8' }} />}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
        <div style={smallTelemetryStyle}><Navigation size={12} color="#2563eb" /><strong>{(boat.distance || 0).toFixed(2)}</strong><small>km</small></div>
        <div style={smallTelemetryStyle}><Activity size={12} color="#059669" /><strong>{(boat.speed || 0).toFixed(1)}</strong><small>km/h</small></div>
        <div style={smallTelemetryStyle}><Timer size={12} color="#f59e0b" /><strong>{pace}</strong></div>
      </div>
    </div>
  );
}

function BoatLayer({ boats, trackingBoatId, selectedMapBoatId, setSelectedMapBoatId, setClusterModalBoats, currentTime, categoryFilter = 'Geral', searchQuery = '' }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const groups = [];
  const processedIds = new Set();
  const filtered = (boats || []).filter(b => (categoryFilter === 'Geral' || b.category === categoryFilter) && (!searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase())));
  const active = filtered.filter(b => b.lat && b.lng);
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
  (boats || []).forEach(b => { if (!categoryLeaders[b.category] || b.distance > (categoryLeaders[b.category].distance || 0)) categoryLeaders[b.category] = b; });
  return (
    <>
      {active.map(b => (
        b.trail && Array.isArray(b.trail) && b.trail.length > 1 && <Polyline key={`trail-${b.id}`} positions={b.trail.map(t => [t.lat, t.lng])} pathOptions={{ color: b.color, weight: 3, opacity: 0.5, dashArray: '5, 10' }} />
      ))}
      {groups.map(group => {
        const { anchor, members } = group;
        if (members.length === 1) {
          const boat = members[0];
          const isSelected = Number(boat.id) === Number(selectedMapBoatId) || Number(boat.id) === Number(trackingBoatId);
          return <Marker key={boat.id} position={[boat.lat, boat.lng]} icon={boatIcon(boat.name, isSelected, boat.color, boat.heading, categoryLeaders[boat.category]?.id === boat.id)} eventHandlers={{ click: () => setSelectedMapBoatId(boat.id) }} />;
        }
        return <Marker key={`cluster-${anchor.id}`} position={[anchor.lat, anchor.lng]} icon={clusterIcon(members.length)} eventHandlers={{ click: () => setClusterModalBoats(members) }} />;
      })}
    </>
  );
}

function MapAutoZoom({ boats, focusId, fitAllTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (focusId) {
      const b = (boats || []).find(x => Number(x.id) === Number(focusId));
      if (b?.lat) map.panTo([b.lat, b.lng], { animate: true });
    }
  }, [boats, focusId, map]);
  useEffect(() => {
    if (fitAllTrigger > 0) {
      const activeBoats = (boats || []).filter(b => b.lat && b.lng);
      if (activeBoats.length > 0) {
        const bounds = L.latLngBounds(activeBoats.map(b => [b.lat, b.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [fitAllTrigger, boats, map]);
  return null;
}

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem('vtl_view') || 'map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [clusterModalBoats, setClusterModalBoats] = useState(null);
  const [mapCategoryFilter, setMapCategoryFilter] = useState('Geral');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [trackSearchQuery, setTrackSearchQuery] = useState('');
  const [boatName, setBoatName] = useState('');
  const [nickname, setNickname] = useState('');
  const [isTracking, setIsTracking] = useState(() => localStorage.getItem('vtl_tracking_active') === 'true');
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
  const [showBgInfo, setShowBgInfo] = useState(true); 
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vtl_admin') === 'true');
  const [activeRankingCategory, setActiveRankingCategory] = useState('Geral');
  const [raceStartTime, setRaceStartTime] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [fitAllTrigger, setFitAllTrigger] = useState(0);
  const isTrackingRef = useRef(isTracking);
  const trackingBoatIdRef = useRef(trackingBoatId);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const wakeLockRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('u') === 'admin' && params.get('p') === 'lago2026') { setIsAdmin(true); localStorage.setItem('vtl_admin', 'true'); setView('admin'); }
  }, []);

  const requestWakeLock = async () => { if ('wakeLock' in navigator && !wakeLockRef.current) { try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {} } };
  useEffect(() => {
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible' && isTrackingRef.current) requestWakeLock(); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
  useEffect(() => { if (!isTracking) localStorage.setItem('vtl_view', view); }, [view, isTracking]);

  const fetchBoats = async () => { try { const res = await axios.get(`${API_URL}/api/boats`); setBoats(res.data); } catch (e) {} };
  useEffect(() => {
    fetchBoats(); const t = setInterval(fetchBoats, 30000);
    const timeT = setInterval(() => setCurrentTime(Date.now()), 10000);
    socket.on('config_updated', d => setRaceStartTime(d.raceStartTime));
    socket.on('location_changed', d => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId)) setSyncStatus('ok');
      setBoats(prev => (prev || []).map(b => Number(b.id) === Number(d.boatId) ? { ...b, ...d } : b));
    });
    socket.on('control_taken', d => { if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId) && d.senderId !== CLIENT_ID) { alert("Outro celular assumiu este barco."); stopTracking(); } });
    return () => { clearInterval(t); clearInterval(timeT); socket.off('config_updated'); socket.off('location_changed'); socket.off('control_taken'); };
  }, []);

  const openSettings = () => { if (Capacitor.getPlatform() === 'android') NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails }); else NativeSettings.openIOS({ option: IOSSettings.App }); };
  const startTracking = async (id) => {
    try {
      if (isApp) await Geolocation.requestPermissions();
      await requestWakeLock();
      setIsTracking(true); isTrackingRef.current = true;
      setTrackingBoatId(id); trackingBoatIdRef.current = id;
      localStorage.setItem('vtl_tracking_id', id);
      localStorage.setItem('vtl_tracking_active', 'true');
      const handler = async (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current > 15000) {
          setSyncStatus('sending');
          let bat = 100; try { const info = await Device.getBatteryInfo(); bat = Math.round(info.batteryLevel * 100); } catch (e) {}
          socket.emit('update_location', { boatId: id, lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading, batteryLevel: bat });
          lastSentRef.current = now;
          setTimeout(() => setSyncStatus('idle'), 2000);
        }
      };
      if (isApp) watchIdRef.current = await Geolocation.watchPosition({ enableHighAccuracy: true }, handler);
      else watchIdRef.current = navigator.geolocation.watchPosition(handler, null, { enableHighAccuracy: true });
    } catch (e) { alert('Erro GPS'); }
  };
  const stopTracking = () => {
    if (trackingBoatIdRef.current) socket.emit('stop_tracking', { boatId: trackingBoatIdRef.current });
    setIsTracking(false); isTrackingRef.current = false;
    if (watchIdRef.current) { if (isApp) Geolocation.clearWatch({ id: watchIdRef.current }); else navigator.geolocation.clearWatch(watchIdRef.current); }
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
    localStorage.removeItem('vtl_tracking_id');
    localStorage.removeItem('vtl_tracking_active');
    window.location.reload();
  };

  const searchResultsMap = mapSearchQuery ? (boats || []).filter(b => b.name.toLowerCase().includes(mapSearchQuery.toLowerCase()) || b.nickname?.toLowerCase().includes(mapSearchQuery.toLowerCase())).slice(0, 5) : [];
  const searchResultsTrack = trackSearchQuery ? (boats || []).filter(b => b.name.toLowerCase().includes(trackSearchQuery.toLowerCase()) || b.nickname?.toLowerCase().includes(trackSearchQuery.toLowerCase())).slice(0, 5) : [];
  const currentBoat = boats.find(b => Number(b.id) === Number(trackingBoatId));

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#f8fafc', position: 'fixed', top: 0, left: 0, overflow: 'hidden' }}>
      {!isTracking && (
        <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 5px', display: 'flex', justifyContent: 'space-around', zIndex: 1000 }}>
          <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={20}/>Mapa</button>
          <button onClick={() => setView('ranking')} style={navBtnStyle}><Trophy size={20}/>Ranking</button>
          <button onClick={() => setView('track')} style={navBtnStyle}><Play size={20}/>Transmitir</button>
          {isAdmin && <button onClick={() => setView('admin')} style={navBtnStyle}><Settings size={20}/>Admin</button>}
        </nav>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {clusterModalBoats && (
          <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}><h3 style={{ margin: 0 }}>Equipes nesta área</h3><button onClick={() => setClusterModalBoats(null)} style={{ background: 'none', border: 'none' }}><X size={24} /></button></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {clusterModalBoats.map(b => (
                  <button key={b.id} onClick={() => { setSelectedMapBoatId(null); setTimeout(() => setSelectedMapBoatId(b.id), 50); setClusterModalBoats(null); }} style={modalButtonStyle}>
                    <span>{b.name}</span><ChevronRight size={18}/>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {(view === 'map' || isTracking) && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}>
            <MapContainer center={[-15.7942, -47.8822]} zoom={13} zoomControl={false} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <BoatLayer boats={boats} trackingBoatId={trackingBoatId} selectedMapBoatId={selectedMapBoatId} setSelectedMapBoatId={setSelectedMapBoatId} setClusterModalBoats={setClusterModalBoats} currentTime={currentTime} />
              <MapAutoZoom boats={boats} focusId={isTracking ? trackingBoatId : selectedMapBoatId} fitAllTrigger={fitAllTrigger} />
            </MapContainer>
            <RaceClock startTime={raceStartTime} />
          </div>
        )}

        {!isTracking && view === 'map' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: '15px', right: '15px', pointerEvents: 'auto' }}>
              <button onClick={() => setFitAllTrigger(t => t + 1)} style={floatingBtnStyle}><Maximize size={24}/></button>
            </div>
            <div style={{ position: 'absolute', top: '15px', left: '15px', right: '75px', pointerEvents: 'auto' }}>
              <div style={{ position: 'relative' }}>
                <div style={{ background: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', padding: '0 12px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', height: '44px' }}>
                  <Search size={16} color="#64748b" />
                  <input placeholder="Buscar equipe..." value={mapSearchQuery} onChange={e => setMapSearchQuery(e.target.value)} style={{ border: 'none', background: 'none', flex: 1, padding: '0 8px', fontSize: '14px', outline: 'none' }} />
                  {mapSearchQuery && <X size={16} color="#64748b" onClick={() => setMapSearchQuery('')} />}
                </div>
                {searchResultsMap.length > 0 && (
                  <div style={{ position: 'absolute', top: '48px', left: 0, right: 0, background: 'white', borderRadius: '12px', boxShadow: '0 8px 25px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                    {searchResultsMap.map(b => (
                      <div key={b.id} onClick={() => { setSelectedMapBoatId(null); setTimeout(() => setSelectedMapBoatId(b.id), 50); setMapSearchQuery(''); }} style={{ padding: '12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: b.color }} />
                        <div style={{ flex: 1 }}><div style={{ fontWeight: 'bold', color: '#1e3a8a', fontSize: '13px' }}>{b.name}</div></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedMapBoatId && (
                <div style={{ marginTop: '8px', pointerEvents: 'auto' }}>
                  <BoatCard boat={boats.find(b => b.id === selectedMapBoatId)} onClose={() => setSelectedMapBoatId(null)} />
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: isTracking ? 30 : 5, overflowY: 'auto', background: (view === 'map' || isTracking) ? 'transparent' : '#f8fafc', pointerEvents: (view === 'map' || isTracking) ? 'none' : 'auto' }}>
          {isTracking ? (
            <div style={{ height: '100%', position: 'relative', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <BoatCard boat={currentBoat} isTracking={true} />
                {showBgInfo && (
                  <div style={{ background: '#1e3a8a', color: 'white', padding: '15px', borderRadius: '15px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', width: '280px', position: 'relative' }}>
                    <button onClick={() => setShowBgInfo(false)} style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', color: 'white', opacity: 0.7 }}><X size={16}/></button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}><Sun size={16} /> MODO TRANSMISSÃO</div>
                    <p style={{ margin: 0, fontSize: '11px', opacity: 0.9, paddingRight: '20px' }}>Para sinal constante, selecione: <strong>Localização - Permitir o tempo todo</strong>.</p>
                    <button onClick={openSettings} style={{ background: '#10b981', border: 'none', color: 'white', padding: '8px', borderRadius: '8px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}><Settings size={14} /> ABRIR CONFIGURAÇÕES</button>
                  </div>
                )}
              </div>
              <div style={{ position: 'absolute', bottom: '35px', left: '25px', right: '25px', pointerEvents: 'auto' }}>
                <SlideToStop onStop={stopTracking} />
              </div>
            </div>
          ) : (
            <div style={{ pointerEvents: 'auto' }}>
              {view === 'ranking' && (
                <div style={{ padding: '20px' }}>
                  <h2 onClick={() => { window._c = (window._c || 0) + 1; if (window._c >= 5) setIsAdmin(true); }}>Classificação</h2>
                  <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginBottom: '15px' }}>
                    {CATEGORIES.map(c => <button key={c} onClick={() => setActiveRankingCategory(c)} style={{ ...catBtnStyle, background: activeRankingCategory === c ? '#1e3a8a' : '#f1f5f9', color: activeRankingCategory === c ? '#fff' : '#64748b' }}>{c}</button>)}
                  </div>
                  {(() => {
                    const filtered = (boats || []).filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory);
                    const online = filtered.filter(b => (currentTime - new Date(b.last_updated).getTime()) / 60000 < 30).sort((a,b) => b.distance - a.distance);
                    const offline = filtered.filter(b => (currentTime - new Date(b.last_updated).getTime()) / 60000 >= 30).sort((a,b) => b.distance - a.distance);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {online.map((b, i) => (
                          <div key={b.id} style={rankCardStyle} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }}>
                            <div style={{ fontSize: '18px', fontWeight: 'bold', width: '30px' }}>{i+1}º</div>
                            <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>{b.category}</small></div>
                            <div style={{ textAlign: 'right' }}><strong>{(b.distance || 0).toFixed(2)} km</strong></div>
                          </div>
                        ))}
                        {offline.map((b) => (
                          <div key={b.id} style={{ ...rankCardStyle, opacity: 0.6, background: '#f1f5f9', border: '1px dashed #cbd5e1' }} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }}>
                            <div style={{ width: '30px', display: 'flex', justifyContent: 'center' }}><WifiOff size={16} color="#94a3b8" /></div>
                            <div style={{ flex: 1, color: '#64748b' }}><strong>{b.name}</strong><br/><small>{b.category} • Sem sinal</small></div>
                            <div style={{ textAlign: 'right', color: '#94a3b8' }}><strong>--</strong></div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {view === 'track' && (
                <div style={{ padding: '30px 20px' }}>
                  <div style={cardStyle}>
                    <h2>Transmitir GPS</h2>
                    <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>Procure sua equipe para iniciar o rastreio.</p>
                    <div style={{ position: 'relative' }}>
                      <div style={{ background: '#f1f5f9', borderRadius: '12px', display: 'flex', alignItems: 'center', padding: '0 15px', height: '55px', border: '1px solid #ddd' }}>
                        <Search size={20} color="#64748b" />
                        <input placeholder="Digite o nome da equipe..." value={trackSearchQuery} onChange={e => setTrackSearchQuery(e.target.value)} style={{ border: 'none', background: 'none', flex: 1, padding: '0 10px', fontSize: '16px', outline: 'none' }} />
                      </div>
                      {searchResultsTrack.length > 0 && (
                        <div style={{ marginTop: '10px', background: 'white', borderRadius: '15px', boxShadow: '0 8px 25px rgba(0,0,0,0.2)', overflow: 'hidden', border: '1px solid #f1f5f9' }}>
                          {searchResultsTrack.map(b => (
                            <div key={b.id} onClick={async () => {
                              setBoatName(b.name); setNickname(b.nickname); setTrackSearchQuery('');
                              try {
                                await axios.post(`${API_URL}/api/boats/${b.id}/take_control`, { senderId: CLIENT_ID });
                                startTracking(b.id);
                              } catch (e) { alert('Erro ao assumir barco'); }
                            }} style={{ padding: '15px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'center', alignItems: 'center', gap: '12px' }}>
                              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color }} />
                              <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>{b.category}</small></div>
                              <ChevronRight size={18} color="#cbd5e1" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {!isApp && (
                      <div style={{ marginTop: '30px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                        <a href="/app.apk" download style={{ ...btnStyle, background: '#059669', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          <Download size={20} /> Baixar App Android
                        </a>
                        <div style={{ marginTop: '12px', background: '#fffbeb', border: '1px solid #fef3c7', padding: '12px', borderRadius: '10px' }}>
                          <p style={{ margin: 0, fontSize: '11px', color: '#92400e', lineHeight: '1.4' }}>
                            <strong>Dica:</strong> No Android, se houver aviso de segurança, clique em "Mais detalhes" e depois em "Instalar assim mesmo".
                          </p>
                        </div>
                      </div>
                    )}
                    
                    <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '10px', color: '#cbd5e1' }}>{VERSION}</div>
                  </div>
                </div>
              )}
              {isAdmin && view === 'admin' && (
                <div style={{ padding: '20px' }}>
                  <h2>Admin</h2>
                  <div style={cardStyle}>
                    {!raceStartTime ? (
                      <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: Date.now() })} style={{ ...btnStyle, background: '#10b981', marginBottom: '10px' }}>INICIAR PROVA</button>
                    ) : (
                      <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: null })} style={{ ...btnStyle, background: '#ef4444', marginBottom: '10px' }}>RESETAR PROVA</button>
                    )}
                    <button onClick={() => { if(confirm("ZERAR TUDO?")) axios.post(`${API_URL}/api/admin/reset_all`); }} style={{ ...btnStyle, background: '#000' }}>LIMPAR BANCO</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{` @keyframes pulse { 0% { transform: scale(0.95); opacity: 0.7; } 50% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(0.95); opacity: 0.7; } } `}</style>
    </div>
  );
}

function RaceClock({ startTime }) {
  const [t, setT] = useState('');
  useEffect(() => {
    if (!startTime) return;
    const i = setInterval(() => {
      const d = Date.now() - startTime;
      const h = Math.floor(d/3600000);
      const m = Math.floor((d%3600000)/60000);
      const s = Math.floor((d%60000)/1000);
      setT(`${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(i);
  }, [startTime]);
  if (!startTime) return null;
  return <div style={{ position: 'absolute', bottom: isApp ? 20 : 80, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(30,58,138,0.9)', color: 'white', padding: '5px 15px', borderRadius: 12, fontWeight: 'bold', pointerEvents: 'none' }}>{t}</div>;
}
