import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, LayersControl } from 'react-leaflet';
const { BaseLayer } = LayersControl;
import L from 'leaflet';
import axios from 'axios';
import { Map as MapIcon, Trophy, Ship, Play, Download, X, Battery, Activity, Navigation, AlertTriangle, LogOut } from 'lucide-react';
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

const boatIcon = (name, status = 'online', isMe = false, customColor, heading = 0, isSos = false, isLeader = false) => {
  const statusColors = { online: '#2563eb', warning: '#f59e0b', lost: '#64748b' };
  const baseColor = isSos ? '#ef4444' : (customColor || (isMe ? '#10b981' : statusColors[status]));
  return L.divIcon({
    html: `<div style="display: flex; flex-direction: column; align-items: center; width: 100px;">
            <div style="background-color: ${baseColor}; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border: 3px solid ${isLeader ? '#f59e0b' : 'white'}; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.5s ease; transform: rotate(${heading}deg); ${isMe ? 'outline: 3px solid #10b981; outline-offset: 2px;' : ''}">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/></svg>
            </div>
            <div style="background: ${isSos ? '#ef4444' : 'rgba(255,255,255,0.9)'}; color: ${isSos ? '#fff' : '#1e293b'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 6px; border: 1px solid #cbd5e1; white-space: nowrap;">${name}</div>
           </div>`,
    className: '', iconSize: [100, 70], iconAnchor: [50, 21]
  });
};

function BoatLayer({ boats, trackingBoatId, setSelectedMapBoatId, currentTime, categoryFilter, searchQuery }) {
  const map = useMap();
  const filtered = (boats || []).filter(b => (categoryFilter === 'Geral' || b.category === categoryFilter) && (!searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase())));
  const active = filtered.filter(b => b.lat && b.lng && (currentTime - new Date(b.last_updated).getTime()) < 3600000);
  const categoryLeaders = {};
  (boats || []).forEach(b => { if (!categoryLeaders[b.category] || b.distance > (categoryLeaders[b.category].distance || 0)) categoryLeaders[b.category] = b; });

  return (
    <>
      {active.map(b => (
        <React.Fragment key={b.id}>
          {b.trail && Array.isArray(b.trail) && b.trail.length > 1 && <Polyline positions={b.trail.map(t => [t.lat, t.lng])} pathOptions={{ color: b.color, weight: 3, opacity: 0.5, dashArray: '5, 10' }} />}
          <Marker position={[b.lat, b.lng]} icon={boatIcon(b.name, 'online', Number(b.id) === Number(trackingBoatId), b.color, b.heading, b.sos_active, categoryLeaders[b.category]?.id === b.id)} eventHandlers={{ click: () => setSelectedMapBoatId && setSelectedMapBoatId(b.id) }} />
        </React.Fragment>
      ))}
    </>
  );
}

function MapAutoZoom({ boats, selectedMapBoatId, focusBoatId }) {
  const map = useMap();
  useEffect(() => {
    const id = focusBoatId || selectedMapBoatId;
    if (id) {
      const b = (boats || []).find(x => Number(x.id) === Number(id));
      if (b?.lat) map.setView([b.lat, b.lng], 16, { animate: true });
    }
  }, [boats, selectedMapBoatId, focusBoatId, map]);
  return null;
}

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem('vtl_view') || 'map');
  const [boats, setBoats] = useState([]);
  const [selectedMapBoatId, setSelectedMapBoatId] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [mapCategoryFilter, setMapCategoryFilter] = useState('Geral');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [boatName, setBoatName] = useState('');
  const [nickname, setNickname] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingBoatId, setTrackingBoatId] = useState(() => localStorage.getItem('vtl_tracking_id'));
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vtl_admin') === 'true');
  const [activeRankingCategory, setActiveRankingCategory] = useState('Geral');
  const [raceStartTime, setRaceStartTime] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);
  const isTrackingRef = useRef(false);
  const trackingBoatIdRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const wakeLockRef = useRef(null);

  useEffect(() => { if (!isTracking) localStorage.setItem('vtl_view', view); }, [view, isTracking]);
  useEffect(() => {
    const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchBoats = async () => { try { const res = await axios.get(`${API_URL}/api/boats`); setBoats(res.data); } catch (e) {} };
  const fetchWaypoints = async () => { try { const res = await axios.get(`${API_URL}/api/waypoints`); setWaypoints(res.data); } catch (e) {} };

  useEffect(() => {
    fetchBoats(); fetchWaypoints();
    const t = setInterval(fetchBoats, 30000);
    socket.on('config_updated', d => { setRaceStartTime(d.raceStartTime); });
    socket.on('location_changed', d => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId)) setSyncStatus('ok');
      setBoats(prev => (prev || []).map(b => Number(b.id) === Number(d.boatId) ? { ...b, ...d, last_updated: d.lastUpdated } : b));
    });
    socket.on('control_taken', d => {
      if (isTrackingRef.current && Number(trackingBoatIdRef.current) === Number(d.boatId) && d.senderId !== CLIENT_ID) {
        alert("Outro celular assumiu este barco."); stopTracking();
      }
    });
    return () => { clearInterval(t); socket.off('config_updated'); socket.off('location_changed'); socket.off('control_taken'); };
  }, []);

  const startTracking = async (id) => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      setIsTracking(true); isTrackingRef.current = true;
      setTrackingBoatId(id); trackingBoatIdRef.current = id;
      localStorage.setItem('vtl_tracking_id', id);
      setView('track');
      
      const handler = async (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current > 30000) {
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
    window.location.reload();
  };

  const currentBoat = boats.find(b => Number(b.id) === Number(trackingBoatId));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      {/* Barra de Navegação - Esconde se estiver rastreando */}
      {!isTracking && (
        <nav style={{ background: '#1e3a8a', color: 'white', padding: '12px 5px', display: 'flex', justifyContent: 'space-around', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
          <button onClick={() => setView('map')} style={navBtnStyle}><MapIcon size={20}/>Mapa</button>
          <button onClick={() => setView('ranking')} style={navBtnStyle}><Trophy size={20}/>Ranking</button>
          <button onClick={() => setView('boats')} style={navBtnStyle}><Ship size={20}/>Equipes</button>
          <button onClick={() => setView('track')} style={navBtnStyle}><Play size={20}/>Transmitir</button>
        </nav>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {view === 'map' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: isLandscape ? 'row' : 'column' }}>
            <MapContainer center={[-15.7942, -47.8822]} zoom={13} style={{ flex: 1 }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <RaceClock startTime={raceStartTime} />
              <BoatLayer boats={boats} trackingBoatId={trackingBoatId} setSelectedMapBoatId={setSelectedMapBoatId} currentTime={currentTime} categoryFilter={mapCategoryFilter} searchQuery={mapSearchQuery} />
              <MapAutoZoom boats={boats} selectedMapBoatId={selectedMapBoatId} focusBoatId={isTracking ? trackingBoatId : null} />
            </MapContainer>
            {selectedMapBoatId && <BoatDetails boat={boats.find(b => b.id === selectedMapBoatId)} onClose={() => setSelectedMapBoatId(null)} onAssume={(b) => { setNickname(b.nickname); startTracking(b.id); }} />}
          </div>
        )}

        {view === 'ranking' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            <h2 style={{ margin: '0 0 15px 0' }}>Classificação</h2>
            <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginBottom: '15px' }}>
              {CATEGORIES.map(c => <button key={c} onClick={() => setActiveRankingCategory(c)} style={{ ...catBtnStyle, background: activeRankingCategory === c ? '#1e3a8a' : '#f1f5f9', color: activeRankingCategory === c ? '#fff' : '#64748b' }}>{c}</button>)}
            </div>
            {boats.filter(b => activeRankingCategory === 'Geral' || b.category === activeRankingCategory).sort((a,b) => b.distance - a.distance).map((b, i) => (
              <div key={b.id} style={rankCardStyle}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', width: '30px' }}>{i+1}º</div>
                <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>{b.category}</small></div>
                <div style={{ textAlign: 'right' }}><strong>{b.distance.toFixed(2)} km</strong></div>
              </div>
            ))}
          </div>
        )}

        {view === 'track' && (
          <div style={{ height: '100%', position: 'relative' }}>
            {!isTracking ? (
              <div style={{ padding: '30px 20px' }}>
                <div style={cardStyle}>
                  <h2 style={{ marginBottom: '20px' }}>Entrar no Barco</h2>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748b' }}>ID DA EQUIPE</label>
                  <input placeholder="Ex: bra316" value={nickname} onChange={e => setNickname(e.target.value)} style={inputStyle} />
                  <button onClick={async () => {
                    const nick = nickname.trim().toLowerCase();
                    if (!nick) return alert('Digite o ID!');
                    try {
                      const res = await axios.post(`${API_URL}/api/boats/auth`, { nickname: nick });
                      setBoatName(res.data.name);
                      await axios.post(`${API_URL}/api/boats/${res.data.id}/take_control`, { senderId: CLIENT_ID });
                      startTracking(res.data.id);
                    } catch (e) { alert('ID não encontrado'); }
                  }} style={btnStyle}>INICIAR TRANSMISSÃO</button>
                  {!isApp && (
                    <div style={{ marginTop: '30px', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '15px' }}>App Android para rastreio em background:</p>
                      <a href="/app.apk" download style={{ ...btnStyle, background: '#059669', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><Download size={18}/> Baixar APK</a>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {/* Mapa em Tela Cheia no fundo */}
                <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
                  <MapContainer center={[-15.7942, -47.8822]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <BoatLayer boats={boats} trackingBoatId={trackingBoatId} currentTime={currentTime} categoryFilter="Geral" />
                    <MapAutoZoom boats={boats} focusBoatId={trackingBoatId} />
                  </MapContainer>
                </div>

                {/* Painel Superior de Telemetria */}
                <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.95)', padding: '15px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', border: '2px solid #10b981', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#059669', fontWeight: '900', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                         <span style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1s infinite' }}></span> TRANSMITINDO AO VIVO
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e3a8a' }}>{boatName}</div>
                      {!raceStartTime && <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 'bold', marginTop: '4px' }}>⚠️ AGUARDANDO LARGADA</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '24px', fontWeight: '900', color: '#1e3a8a' }}>{currentBoat?.distance?.toFixed(2) || '0.00'} <span style={{ fontSize: '12px' }}>KM</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                        <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b' }}><Battery size={14}/> {currentBoat?.battery_level || '--'}%</div>
                        <div style={{ fontSize: '11px', color: syncStatus === 'sending' ? '#2563eb' : '#059669', fontWeight: 'bold' }}>{syncStatus === 'sending' ? 'Sincronizando...' : 'OK'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botão de Parar Inferior */}
                <div style={{ position: 'absolute', bottom: '20px', left: '20px', right: '20px', zIndex: 10 }}>
                  <button onClick={() => { if(confirm("Deseja realmente parar a transmissão?")) stopTracking(); }} style={{ ...btnStyle, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 4px 20px rgba(239,68,68,0.4)' }}>
                    <LogOut size={20} /> PARAR RASTREIO
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'boats' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            <h2 onClick={() => { window._c = (window._c || 0) + 1; if (window._c >= 5) { setIsAdmin(true); setView('admin'); } }}>Equipes</h2>
            {boats.map(b => (
              <div key={b.id} style={rankCardStyle}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: b.color }} />
                <div style={{ flex: 1 }}><strong>{b.name}</strong><br/><small>ID: {b.nickname.toUpperCase()}</small></div>
                <button onClick={() => { setNickname(b.nickname); setView('track'); }} style={{ ...catBtnStyle, background: '#f1f5f9', color: '#1e3a8a' }}>Acessar</button>
              </div>
            ))}
          </div>
        )}

        {isAdmin && view === 'admin' && (
          <div style={{ padding: '20px' }}>
            <h2 style={{ marginBottom: '20px' }}>Painel do Juiz</h2>
            <div style={cardStyle}>
              <p style={{ fontSize: '13px', color: '#64748b' }}>Inicie a prova para começar a computar a distância de todos os barcos simultaneamente.</p>
              {!raceStartTime ? (
                <button onClick={() => axios.post(`${API_URL}/api/config`, { raceStartTime: Date.now() })} style={{ ...btnStyle, background: '#10b981', marginBottom: '10px' }}>DAR LARGADA OFICIAL</button>
              ) : (
                <button onClick={() => { if(confirm("Isso irá resetar o tempo de prova para todos. Confirmar?")) axios.post(`${API_URL}/api/config`, { raceStartTime: null }); }} style={{ ...btnStyle, background: '#ef4444', marginBottom: '10px' }}>RESETAR TEMPO</button>
              )}
              <button onClick={() => { window.open(`${API_URL}/api/admin/export`, '_blank'); }} style={{ ...btnStyle, background: '#1e3a8a', marginBottom: '10px' }}>EXPORTAR RESULTADOS (CSV)</button>
              <button onClick={() => { if(confirm("DANGER: Isso irá zerar a distância de todos os barcos. Tem certeza?")) axios.post(`${API_URL}/api/admin/reset_all`); }} style={{ ...btnStyle, background: '#000' }}>ZERAR TUDO</button>
            </div>
            <button onClick={() => setView('map')} style={{ ...btnStyle, background: 'none', color: '#64748b', marginTop: '20px' }}>Voltar ao Mapa</button>
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
  return <div style={{ position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(30,58,138,0.9)', color: 'white', padding: '8px 15px', borderRadius: 12, fontWeight: '900', border: '2px solid white', fontSize: '18px', fontFamily: 'monospace' }}>{t}</div>;
}

function BoatDetails({ boat, onClose, onAssume }) {
  return (
    <div style={{ flex: '0 0 45%', background: 'white', padding: '20px', borderTop: '2px solid #ddd', overflowY: 'auto', boxShadow: '0 -4px 20px rgba(0,0,0,0.1)', zIndex: 1001 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>{boat.name}</h3><X onClick={onClose}/></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', margin: '15px 0' }}>
        <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '10px' }}><small>DISTÂNCIA</small><br/><strong>{boat.distance.toFixed(2)} km</strong></div>
        <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '10px' }}><small>BATERIA</small><br/><strong>{boat.battery_level}%</strong></div>
      </div>
      <button onClick={() => onAssume(boat)} style={btnStyle}>Assumir Barco</button>
    </div>
  );
}

const navBtnStyle = { background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '10px', gap: '2px', opacity: 0.8 };
const btnStyle = { width: '100%', padding: '16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '16px' };
const inputStyle = { width: '100%', padding: '16px', margin: '8px 0 20px 0', borderRadius: '12px', border: '1px solid #ddd', boxSizing: 'border-box', fontSize: '18px' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' };
const rankCardStyle = { background: 'white', padding: '15px', borderRadius: '15px', display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px', border: '1px solid #f1f5f9' };
const catBtnStyle = { padding: '8px 18px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' };
