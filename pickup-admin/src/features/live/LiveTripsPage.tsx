'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Search, Truck, X, MapPin, Maximize, Minus, Plus, Navigation, Clock, Activity, FileText
} from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Loader } from '@/components/ui/Loader/Loader';
import { fetchInitialLiveData } from '@/services/liveTripService';
import { mockRealtimeService } from '@/services/mockRealtimeService';
import type { LiveOperationsData, LiveTrip } from '@/types/live';
import m from '@/components/ui/shared/module.module.css';
import styles from './LiveTripsPage.module.css';

// Jodhpur center for mapping lat/lng to percentage based coordinates on screen
const MAP_CENTER = { lat: 26.2809, lng: 73.0227 };
const LAT_RANGE = 0.15;
const LNG_RANGE = 0.15;

function latLngToPercent(lat: number, lng: number) {
  const x = ((lng - (MAP_CENTER.lng - LNG_RANGE/2)) / LNG_RANGE) * 100;
  const y = (1 - (lat - (MAP_CENTER.lat - LAT_RANGE/2)) / LAT_RANGE) * 100;
  return { left: `${Math.max(0, Math.min(100, x))}%`, top: `${Math.max(0, Math.min(100, y))}%` };
}

function timeAgo(dateString: string) {
  const diff = Math.floor((new Date().getTime() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return `${diff} sec ago`;
  return `${Math.floor(diff / 60)} min ago`;
}

export default function LiveTripsPage() {
  const router = useRouter();
  const [data, setData] = useState<LiveOperationsData | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  useEffect(() => {
    fetchInitialLiveData().then(d => {
      setData(d);
      setSimRunning(mockRealtimeService.isRunning);
    });

    const unsub = mockRealtimeService.subscribe((newData) => {
      setData(newData);
    });

    return () => unsub();
  }, []);

  const toggleSimulation = () => {
    if (mockRealtimeService.isRunning) {
      mockRealtimeService.stopSimulation();
      setSimRunning(false);
    } else {
      mockRealtimeService.startSimulation();
      setSimRunning(true);
    }
  };

  const filteredTrips = useMemo(() => {
    if (!data) return [];
    if (!search) return data.activeTrips;
    const q = search.toLowerCase();
    return data.activeTrips.filter(t => 
      t.bookingId.toLowerCase().includes(q) || 
      t.driverName.toLowerCase().includes(q) || 
      t.vehicleRegistrationNumber.toLowerCase().includes(q)
    );
  }, [data, search]);

  const selectedTrip = useMemo(() => {
    return data?.activeTrips.find(t => t.bookingId === selectedTripId) || null;
  }, [data, selectedTripId]);

  if (!data) return <AdminLayout pageTitle="Live Operations"><Loader fullPage /></AdminLayout>;

  return (
    <AdminLayout pageTitle="Live Operations">
      <div className={styles.container}>
        
        {/* Sidebar List */}
        <div className={styles.sidebar}>
          <div className={styles.header}>
            <h2 className={styles.title}>
              Active Trips
              <Badge variant="info">{data.activeTrips.length}</Badge>
            </h2>
            <div className={styles.searchBox}>
              <Search className={styles.searchIcon} size={14} />
              <input 
                className={styles.searchInput}
                placeholder="Search trip, driver, vehicle..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}><X size={14} /></button>}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Mock Simulation:</span>
              <Button size="sm" variant={simRunning ? "primary" : "ghost"} onClick={toggleSimulation} leftIcon={<Activity size={12} />}>
                {simRunning ? 'ON' : 'OFF'}
              </Button>
            </div>
          </div>

          <div className={styles.tripList}>
            {filteredTrips.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>No active trips matching criteria.</div>
            ) : (
              filteredTrips.map(trip => (
                <div 
                  key={trip.bookingId} 
                  className={`${styles.tripItem} ${selectedTripId === trip.bookingId ? styles.active : ''}`}
                  onClick={() => setSelectedTripId(trip.bookingId)}
                >
                  <div className={styles.tripHeader}>
                    <span className={styles.tripId}>{trip.bookingId}</span>
                    <Badge variant={trip.status === 'In Transit' ? 'success' : 'warning'}>{trip.status}</Badge>
                  </div>
                  <div className={styles.tripDriver}>{trip.driverName} • {trip.vehicleRegistrationNumber}</div>
                  <div className={styles.tripRoute}>
                    {trip.pickup.address?.split(',')[0]} → {trip.drops[0]?.location.address?.split(',')[0]}
                  </div>
                  <div className={styles.tripUpdate}>Updated {timeAgo(trip.lastUpdate)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Map Area */}
        <div className={styles.mapArea}>
          <div className={styles.mapGrid} />
          
          <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.9)', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', boxShadow: 'var(--shadow-sm)', zIndex: 5 }}>
            📍 Jodhpur Operational Area (Mock Map)
          </div>

          {/* Render Trip Markers */}
          {filteredTrips.map(trip => {
            const isSelected = selectedTripId === trip.bookingId;
            const pos = latLngToPercent(trip.currentLocation.lat, trip.currentLocation.lng);
            return (
              <div 
                key={trip.bookingId} 
                className={styles.marker} 
                style={pos}
                onClick={() => setSelectedTripId(trip.bookingId)}
              >
                <div className={`${styles.markerIcon} ${isSelected ? styles.selected : ''}`}>
                  <Truck size={16} />
                </div>
                <div className={styles.markerLabel}>{trip.driverName.split(' ')[0]}</div>
              </div>
            );
          })}

          <div className={styles.mapControls}>
            <button className={styles.mapControlBtn}><Plus size={18} /></button>
            <button className={styles.mapControlBtn}><Minus size={18} /></button>
            <button className={styles.mapControlBtn}><Maximize size={18} /></button>
          </div>
        </div>

        {/* Selected Trip Detail Panel Overlay */}
        {selectedTrip && (
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedTrip.bookingId}</div>
              <button onClick={() => setSelectedTripId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={16} /></button>
            </div>
            
            <div className={styles.detailBody}>
              <div>
                <Badge variant={selectedTrip.status === 'In Transit' ? 'success' : 'warning'}>{selectedTrip.status}</Badge>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} /> Last updated: {timeAgo(selectedTrip.lastUpdate)}
                </div>
              </div>

              <div>
                <div className={styles.detailSectionTitle}>Driver & Vehicle</div>
                <div className={styles.detailValue}>{selectedTrip.driverName}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{selectedTrip.vehicleRegistrationNumber} ({selectedTrip.vehicleCategoryName.split(' / ')[0]})</div>
              </div>

              <div>
                <div className={styles.detailSectionTitle}>Location</div>
                <div className={styles.detailValue} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Navigation size={14} style={{ marginTop: 2, color: 'var(--color-brand-500)', flexShrink: 0 }} />
                  <span>{selectedTrip.currentLocation.address} <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, display: 'block' }}>{selectedTrip.currentLocation.lat.toFixed(4)}, {selectedTrip.currentLocation.lng.toFixed(4)}</span></span>
                </div>
              </div>

              <div>
                <div className={styles.detailSectionTitle}>Progress</div>
                <div style={{ paddingLeft: 8, borderLeft: '2px solid var(--color-border)', marginLeft: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: -13, top: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success-500)' }} />
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Pickup</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{selectedTrip.pickup.address?.split(',')[0]}</div>
                  </div>
                  {selectedTrip.drops.map((drop, idx) => (
                    <div key={drop.id} style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: -13, top: 4, width: 6, height: 6, borderRadius: '50%', background: drop.status === 'Completed' ? 'var(--color-success-500)' : 'var(--color-gray-300)' }} />
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Drop {idx + 1} {drop.status === 'Completed' ? '✓' : ''}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{drop.location.address?.split(',')[0]}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <Button variant="outline" size="sm" style={{ width: '100%' }} onClick={() => router.push(`/bookings/${selectedTrip.bookingId}`)} leftIcon={<FileText size={14} />}>
                  View Full Booking
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
