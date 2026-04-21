import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Trophy, Ship, Play, Download, X, Battery, LogOut, Activity, Navigation, Timer, Maximize, Search } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings';

const isApp = Capacitor.isNativePlatform();
const BACKEND_URL = 'https://voltaaolago-backend.onrender.com';
const API_URL = isApp ? BACKEND_URL : ((window.location.hostname === 'localhost') ? 'http://localhost:3001' : BACKEND_URL);
const socket = io(API_URL);

const CATEGORIES = ['Geral', 'Estreante', 'Open', '40+', '50+', '60/70+'];
const CLIENT_ID = Math.random().toString(36).substring(7);

const boatIcon = (name, isMe = false, color = '#2563eb', heading = 0, isLeader = false) => L.divIcon({
  html: `<div style="display: flex; flex-direction: column; align-items: center; width: 100px;">
          <div style="background-color: ${color}; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border: 3px solid ${isLeader ? '#f59e0b' : 'white'}; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.5s ease; transform: rotate(${heading}deg); ${isMe ? 'outline: 3px solid #10b981; outline-offset: 2px;' : ''}">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/></svg>
          </div>
          <div style="background: rgba(255,255,255,0.9); color: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 6px; border: 1px solid #cbd5e1; white-space: nowrap;">${name}</div>
         </div>`,
  className: '', iconSize: [100, 70], iconAnchor: [50, 21]
});

function BoatLayer({ boats, trackingBoatId, setSelectedMapBoatId, currentTime, categoryFilter = 'Geral', searchQuery = '' }) {
  const filtered = (boats || []).filter(b => (categoryFilter === 'Geral' || b.category === categoryFilter) && (!searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase())));
  const active = filtered.filter(b => b.lat && b.lng);
  const categoryLeaders = {};
  (boats || []).forEach(b => { if (!categoryLeaders[b.category] || b.distance > (categoryLeaders[b.category].distance || 0)) categoryLeaders[b.category] = b; });
  return (
    <>
      {active.map(b => (
        <React.Fragment key={b.id}>
          {b.trail && Array.isArray(b.trail) && b.trail.length > 1 && <Polyline positions={b.trail.map(t => [t.lat, t.lng])} pathOptions={{ color: b.color, weight: 3, opacity: 0.5, dashArray: '5, 10' }} />}
          <Marker position={[b.lat, b.lng]} icon={boatIcon(b.name, Number(b.id) === Number(trackingBoatId), b.color, b.heading, categoryLeaders[b.category]?.id === b.id)} eventHandlers={{ click: () => setSelectedMapBoatId && setSelectedMapBoatId(b.id) }} />
        </React.Fragment>
      ))}
    </>
  );
}

function MapAutoZoom({ boats, focusId, fitAllTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (focusId) {
      const b = (boats || []).find(x => Number(x.id) === Number(focusId));
      if (b?.lat) map.setView([b.lat, b.lng], 16, { animate: true });
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
  const [mapCategoryFilter, setMapCategoryFilter] = useState('Geral');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [boatName, setBoatName] = useState('');
  const [nickname, setNickname] = useState('');
  const [isTracking, setIsTracking] = useState(() => localStorage.getItem('vtl_tracking_active') === 'true');
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
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

  useEffect(() => { if (!isTracking) localStorage.setItem('vtl_view', view); }, [view, isTracking]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('u') === 'admin' && params.get('p') === 'lago2026') { 
      setIsAdmin(true); localStorage.setItem('vtl_admin', 'true'); setView('admin'); 
    }
  }, []);

  const fetchBoats = async () => { try { const res = await axios.get(`${API_URL}/api/boats`); setBoats(res.data); } catch (e) {} };

  useEffect(() => {
    fetchBoats(); const t = setInterval(fetchBoats, 30000);
    socket.on('config_updated', d => setRaceStartTime(d.raceStartTime));
    socket.on('location_changed', d => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId)) setSyncStatus('ok');
      setBoats(prev => (prev || []).map(b => Number(b.id) === Number(d.boatId) ? { ...b, ...d } : b));
    });
    socket.on('control_taken', d => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId) && d.senderId !== CLIENT_ID) {
        alert("Outro celular assumiu este barco."); stopTracking();
      }
    });
    return () => { clearInterval(t); socket.off('config_updated'); socket.off('location_changed'); socket.off('control_taken'); };
  }, []);

  useEffect(() => {
    if (isTracking && trackingBoatId && !watchIdRef.current) {
      const b = boats.find(x => Number(x.id) === Number(trackingBoatId));
      if (b) { setBoatName(b.name); setNickname(b.nickname); }
      startTracking(trackingBoatId, true);
    }
  }, [boats]);

  const startTracking = async (id, isReconnect = false) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      setIsTracking(true); isTrackingRef.current = true;
      setTrackingBoatId(id); trackingBoatIdRef.current = id;
      localStorage.setItem('vtl_tracking_id', id);
      localStorage.setItem('vtl_tracking_active', 'true');
      
      const handler = async (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current > 20000) {
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
    setIsTracking(false); isTrackingRef.current = false;
    if (watchIdRef.current) { if (isApp) Geolocation.clearWatch({ id: watchIdRef.current }); else navigator.geolocation.clearWatch(watchIdRef.current); }
    if (wakeLockRef.current) wakeLockRef.current.release();
    localStorage.removeItem('vtl_tracking_id');
    localStorage.removeItem('vtl_tracking_active');
    window.location.reload();
  };

  const calculatePace = (speedKmh) => {
    if (!speedKmh || speedKmh < 0.5) return '--:--';
    const paceDecimal = 60 / speedKmh;
    const mins = Math.floor(paceDecimal);
    const secs = Math.round((paceDecimal - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentBoat = boats.find(b => Number(b.id) === Number(trackingBoatId));
  const searchResults = mapSearchQuery ? boats.filter(b => b.name.toLowerCase().includes(mapSearchQuery.toLowerCase()) || b.nickname?.toLowerCase().includes(mapSearchQuery.toLowerCase())).slice(0, 5) : [];

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc', position: 'fixed', top: 0, left: 0 }}>
      {!isTracking && (
        <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 5px', display: 'flex', justifyContent: 'space-around', zIndex: 1000 }}>
          <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={20}/>Mapa</button>
          <button onClick={() => setView('ranking')} style={navBtnStyle}><Trophy size={20}/>Ranking</button>
          <button onClick={() => setView('boats')} style={navBtnStyle}><Ship size={20}/>Equipes</button>
          <button onClick={() => setView('track')} style={navBtnStyle}><Play size={20}/>Transmitir</button>
        </nav>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* MAPA SEMPRE NO FUNDO */}
        {(view === 'map' || isTracking) && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}>
            <MapContainer center={[-15.7942, -47.8822]} zoom={13} zoomControl={false} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <RaceClock startTime={raceStartTime} />
              <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} currentTime={currentTime} />
              <MapAutoZoom boats={boats} focusId={isTracking ? trackingBoatId : selectedMapBoatId} fitAllTrigger={fitAllTrigger} />
            </MapContainer>
            
            {/* Botões Flutuantes do Mapa */}
            {!isTracking && view === 'map' && (
              <div style={{ position: 'absolute', top: '15px', right: '15px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button onClick={() => setFitAllTrigger(t => t + 1)} style={floatingBtnStyle} title="Ver Todos"><Maximize size={24}/></button>
              </div>
            )}
            
            {/* Busca Flutuante no Mapa */}
            {!isTracking && view === 'map' && (
              <div style={{ position: 'absolute', top: '15px', left: '15px', right: '70px', zIndex: 10 }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ background: 'white', borderRadius: '15px', display: 'flex', alignItems: 'center', padding: '0 15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', height: '50px' }}>
                    <Search size={18} color="#64748b" />
                    <input 
                      placeholder="Buscar equipe..." 
                      value={mapSearchQuery} 
                      onChange={e => setMapSearchQuery(e.target.value)} 
                      style={{ border: 'none', background: 'none', flex: 1, padding: '0 10px', fontSize: '15px', outline: 'none' }} 
                    />
                    {mapSearchQuery && <X size={18} color="#64748b" onClick={() => setMapSearchQuery('')} />}
                  </div>
                  {searchResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '55px', left: 0, right: 0, background: 'white', borderRadius: '15px', boxShadow: '0 8px 25px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                      {searchResults.map(b => (
                        <div key={b.id} onClick={() => { setSelectedMapBoatId(b.id); setMapSearchQuery(''); }} style={{ padding: '15px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: b.color }} />
                          <div><div style={{ fontWeight: 'bold', color: '#1e3a8a', fontSize: '14px' }}>{b.name}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{b.category}</div></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OVERLAY: TRANSMITINDO */}
        {isTracking && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', pointerEvents: 'auto' }}>
              <div style={{ background: 'rgba(255,255,255,0.98)', padding: '15px', borderRadius: '20px', border: '2px solid #10b981', boxShadow: '0 8px 25px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                  <div>
                    <div style={{ color: '#059669', fontWeight: '900', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', animation: 'pulse 1s infinite' }}></span> TRANSMITINDO AO VIVO
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: '#1e3a8a' }}>{boatName}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>ID: {nickname.toUpperCase()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', color: '#64748b' }}>
                       {syncStatus === 'sending' ? 'Sincronizando...' : 'Sinal OK'} <Battery size={14} color={currentBoat?.battery_level < 20 ? '#ef4444' : '#64748b'}/> {currentBoat?.battery_level || '--'}%
                    </div>
                    {!raceStartTime && <div style={{ fontSize: '10px', color: '#f59e0b', fontWeight: 'bold', marginTop: '4px' }}>AGUARDANDO LARGADA</div>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  <div style={telemetryCard}>
                    <Navigation size={16} color="#2563eb" />
                    <div><small style={telemetryLabel}>DISTÂNCIA</small><br/><strong style={telemetryValue}>{currentBoat?.distance.toFixed(2) || '0.00'}</strong><small style={unitLabel}> km</small></div>
                  </div>
                  <div style={telemetryCard}>
                    <Activity size={16} color="#059669" />
                    <div><small style={telemetryLabel}>VELOCIDADE</small><br/><strong style={telemetryValue}>{currentBoat?.speed?.toFixed(1) || '0.0'}</strong><small style={unitLabel}> km/h</small></div>
                  </div>
                  <div style={telemetryCard}>
                    <Timer size={16} color="#f59e0b" />
                    <div><small style={telemetryLabel}>PACE</small><br/><strong style={telemetryValue}>{calculatePace(currentBoat?.speed)}</strong><small style={unitLabel}> /km</small></div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: '25px', left: '25px', right: '25px', pointerEvents: 'auto' }}>
              <button onClick={() => { if(confirm("Parar transmissão?")) stopTracking(); }} style={{ ...btnStyle, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', height: '60px', boxShadow: '0 4px 20px rgba(239,68,68,0.4)' }}>
                <LogOut size={22} /> PARAR RASTREIO
              </button>
            </div>
          </div>
        )}

        {!isTracking && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, overflowY: 'auto', background: view === 'map' ? 'transparent' : '#f8fafc', pointerEvents: view === 'map' && !selectedMapBoatId ? 'none' : 'auto' }}>
            {view === 'map' && selectedMapBoatId && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                <BoatDetails boat={boats.find(b => b.id === selectedMapBoatId)} onClose={() => setSelectedMapBoatId(null)} onAssume={(b) => { setNickname(b.nickname); startTracking(b.id); }} />
              </div>
            )}

            {view === 'ranking' && (
              <div style={{ padding: '20px' }}>
                <h2>Classificação</h2>
                <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginBottom: '15px' }}>
                  {CATEGORIES.map(c => <button key={c} onClick={() => setActiveRankingCategory(c)} style={{ ...catBtnStyle, background: activeRankingCategory === c ? '#1e3a8a' : '#f1f5f9', color: activeRankingCategory === c ? '#fff' : '#64748b' }}>{c}</button>)}
                </div>
                {boats.filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory).sort((a,b) => b.distance - a.distance).map((b, i) => (
                  <div key={b.id} style={rankCardStyle} onClick={() => { setSelectedMapBoatId(b.id); setView('map'); }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', width: '30px' }}>{i+1}º</div>
                    <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>{b.category}</small></div>
                    <div style={{ textAlign: 'right' }}><strong>{b.distance.toFixed(2)} km</strong></div>
                  </div>
                ))}
              </div>
            )}

            {view === 'boats' && (
              <div style={{ padding: '20px' }}>
                <h2 onClick={() => { window._c = (window._c || 0) + 1; if (window._c >= 5) setIsAdmin(true); }}>Equipes</h2>
                {boats.map(b => (
                  <div key={b.id} style={rankCardStyle}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color }} />
                    <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>ID: {b.nickname.toUpperCase()}</small></div>
                    <button onClick={() => { setNickname(b.nickname); setView('track'); }} style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', background: '#f1f5f9' }}>Acessar</button>
                  </div>
                ))}
              </div>
            )}

            {view === 'track' && (
              <div style={{ padding: '30px 20px' }}>
                <div style={cardStyle}>
                  <h2>Transmitir GPS</h2>
                  <input placeholder="ID (ex: bra316)" value={nickname} onChange={e => setNickname(e.target.value)} style={inputStyle} />
                  <button onClick={async () => {
                    const nick = nickname.trim().toLowerCase();
                    try {
                      const res = await axios.post(`${API_URL}/api/boats/auth`, { nickname: nick });
                      setBoatName(res.data.name);
                      await axios.post(`${API_URL}/api/boats/${res.data.id}/take_control`, { senderId: CLIENT_ID });
                      startTracking(res.data.id);
                    } catch (e) { alert('ID não encontrado'); }
                  }} style={btnStyle}>ENTRAR NO BARCO</button>
                  {!isApp && <a href="/app.apk" download style={{ ...btnStyle, background: '#059669', textDecoration: 'none', display: 'block', textAlign: 'center', marginTop: '20px' }}>Baixar App Android</a>}
                </div>
              </div>
            )}

            {isAdmin && view === 'admin' && (
              <div style={{ padding: '20px' }}>
                <h2>Painel Admin</h2>
                <div style={cardStyle}>
                  {!raceStartTime ? (
                    <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: Date.now() })} style={{ ...btnStyle, background: '#10b981', marginBottom: '10px' }}>INICIAR PROVA</button>
                  ) : (
                    <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: null })} style={{ ...btnStyle, background: '#ef4444', marginBottom: '10px' }}>RESETAR PROVA</button>
                  )}
                  <button onClick={() => { window.open(`${API_URL}/api/admin/export`, '_blank'); }} style={{ ...btnStyle, background: '#1e3a8a', marginBottom: '10px' }}>EXPORTAR CSV</button>
                  <button onClick={() => { if(confirm("ZERAR TUDO?")) axios.post(`${API_URL}/api/admin/reset_all`); }} style={{ ...btnStyle, background: '#000' }}>LIMPAR BANCO</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
  return <div style={{ position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(30,58,138,0.9)', color: 'white', padding: '8px 15px', borderRadius: 12, fontWeight: 'bold' }}>{t}</div>;
}

function BoatDetails({ boat, onClose, onAssume }) {
  if (!boat) return null;
  return (
    <div style={{ background: 'white', padding: 20, borderTop: '2px solid #ddd', boxShadow: '0 -4px 15px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>{boat.name}</h3><X onClick={onClose}/></div>
      <p>Distância: {boat.distance.toFixed(2)} km | Bateria: {boat.battery_level}%</p>
      <button onClick={() => onAssume(boat)} style={btnStyle}>Assumir Barco</button>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '10px', gap: '2px' };
const btnStyle = { width: '100%', padding: '16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '16px' };
const inputStyle = { width: '100%', padding: '16px', marginBottom: '15px', borderRadius: '12px', border: '1px solid #ddd', boxSizing: 'border-box' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' };
const rankCardStyle = { background: 'white', padding: '15px', borderRadius: '15px', display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px', border: '1px solid #f1f5f9' };
const catBtnStyle = { padding: '8px 15px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' };
const telemetryCard = { background: '#f8fafc', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #e2e8f0' };
const telemetryLabel = { fontSize: '9px', color: '#64748b', fontWeight: 'bold' };
const telemetryValue = { fontSize: '18px', fontWeight: '900', color: '#1e3a8a' };
const unitLabel = { fontSize: '10px', color: '#64748b' };
const floatingBtnStyle = { background: 'white', border: 'none', borderRadius: '15px', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyCenter: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', color: '#1e3a8a', cursor: 'pointer', padding: '13px' };
