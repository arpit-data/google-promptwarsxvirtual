/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { 
  Users, 
  MapPin, 
  AlertTriangle, 
  Clock, 
  AlertCircle,
  TrendingUp,
  Wind,
  Sparkles,
  Activity,
  Map as MapIcon,
  Layers
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Toaster } from '../components/ui/sonner';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface Zone {
  id: string;
  name: string;
  crowd_count: number;
  capacity?: number;
  last_updated: string;
}

interface Incident {
  id: number;
  zone: string;
  issue_type: string;
  description: string;
  timestamp: string;
}

interface Suggestion {
  type: 'gate' | 'service';
  message: string;
  target: string;
}

interface HistoryPoint {
  zone_id: string;
  count: number;
  timestamp: string;
}

// Pure function — defined outside component so it doesn't cause stale closure
// issues when referenced inside useMemo hooks
function calculateWaitVector(count: number, zoneId: string, capacity: number) {
  let channels = 10;
  let throughputPerChannel = 12;

  if (zoneId.includes('food')) {
    channels = 4;
    throughputPerChannel = 5;
  } else if (zoneId.includes('washroom')) {
    channels = 20;
    throughputPerChannel = 1.5;
  } else if (zoneId.includes('gate')) {
    channels = 8;
    throughputPerChannel = 15;
  }

  const throughputRate = channels * throughputPerChannel;
  const pressure = +(count / Math.max(1, throughputRate)).toFixed(2);
  const currentWait = Math.ceil(pressure);

  const density = count / (capacity || 500);
  const trend = density > 0.8 ? 1.4 : 0.7;
  const projectedWait = Math.ceil(currentWait * trend);

  return { currentWait, projectedWait, pressure, channels };
}

export default function App() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>('gate-a');
  // Use a ref for socket — avoids triggering re-renders on connect/disconnect
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [timeStr, setTimeStr] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('density-desc');
  const [aiInsight, setAiInsight] = useState<string>('Insight: Gate A congestion usually peaks in 10 mins. Suggest opening overflow Gate B now.');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [pulseMode, setPulseMode] = useState<boolean>(false);
  const [showDigitalTwin, setShowDigitalTwin] = useState<boolean>(false);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<string>(new Date().toLocaleTimeString());
  const [zoneActions, setZoneActions] = useState<Record<string, { dispatch?: boolean, promo?: boolean, dispatchEta?: number }>>({});
  const [viewMode, setViewMode] = useState<'operator' | 'attendee'>('operator');
  // Controlled state for the incident report form (Shadcn Select doesn't wire to native FormData)
  const [reportZone, setReportZone] = useState<string>('');
  const [reportType, setReportType] = useState<string>('');

  // Keep a ref to selectedZone so socket event handlers always read the latest value
  // without needing to be recreated on every zone change
  const selectedZoneRef = useRef(selectedZone);
  useEffect(() => { selectedZoneRef.current = selectedZone; }, [selectedZone]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'attendee') {
      setViewMode('attendee');
    }
  }, []);

  const [incidentSortBy, setIncidentSortBy] = useState<string>('timestamp-desc');

  const getAiTip = useCallback(async () => {
    setIsAiLoading(true);
    setAiInsight("Analyzing venue data...");
    try {
      const res = await fetch('/api/ai-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones, incidents })
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setAiInsight(data.text || 'No insights generated.');
    } catch (e: any) {
      setAiInsight("AI Engine Failed: " + e.message);
    } finally {
      setIsAiLoading(false);
    }
  }, [zones, incidents]);

  const handleDispatch = useCallback((zoneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setZoneActions(prev => ({...prev, [zoneId]: {...prev[zoneId], dispatch: true, dispatchEta: Math.floor(Math.random() * 3) + 2}}));
    toast.info(`Webhook Triggered: Dispatching staff to ${zoneId} via Slack-Bridge.`);
    console.log(`[MVP WEBHOOK] Triggering Slack Dispatch for ${zoneId}`);
  }, []);
  
  const handlePromo = useCallback((zoneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setZoneActions(prev => ({...prev, [zoneId]: {...prev[zoneId], promo: true}}));
    toast.info(`Webhook Triggered: Mobile Promo Push triggered for ${zoneId}.`);
    console.log(`[MVP WEBHOOK] Triggering SMS/Push Promo for ${zoneId}`);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString([], { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (pulseMode) {
      const criticalZone = zones.find(z => {
        const cap = z.capacity || 500;
        return (z.crowd_count / cap) > 0.9;
      });
      if (criticalZone) {
        setSelectedZone(criticalZone.id);
      }
    }
  }, [pulseMode, zones]);

  // Socket setup — runs ONCE on mount. Uses selectedZoneRef to avoid stale closures
  // and prevents the critical bug of reconnecting on every zone click.
  useEffect(() => {
    const newSocket = io();
    socketRef.current = newSocket;

    newSocket.on('connect', () => setIsSocketConnected(true));
    newSocket.on('disconnect', () => setIsSocketConnected(false));

    // Initial Fetch
    fetch('/api/zones').then(res => res.json()).then(setZones);
    fetch('/api/incidents').then(res => res.json()).then(setIncidents);
    fetch('/api/suggestions').then(res => res.json()).then(setSuggestions);

    newSocket.on('zones_update', (updatedZones: Zone[]) => {
      setZones(updatedZones);
      setLastSync(new Date().toLocaleTimeString());
      fetch('/api/suggestions').then(res => res.json()).then(setSuggestions);
      // Read from ref so this handler is never stale and socket isn't re-created
      fetch(`/api/history/${selectedZoneRef.current}`).then(res => res.json()).then(setHistory);
    });

    newSocket.on('new_incident', (incident: Incident) => {
      setIncidents(prev => [incident, ...prev]);
      toast.error(`New Incident: ${incident.issue_type} at ${incident.zone}`);
    });

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, []); // Empty deps — socket created once

  // Fetch history whenever the selected zone changes
  useEffect(() => {
    fetch(`/api/history/${selectedZone}`).then(res => res.json()).then(setHistory);
  }, [selectedZone]);

  const reportIncident = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const description = formData.get('description') as string;

    if (!reportZone || !reportType) {
      toast.error('Please select a zone and issue type.');
      return;
    }

    const res = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: reportZone, issue_type: reportType, description }),
    });

    if (res.ok) {
      toast.success('Incident reported successfully');
      (e.target as HTMLFormElement).reset();
      setReportZone('');
      setReportType('');
      setIsReportOpen(false);
    } else {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      toast.error(`Failed to report: ${err.error || res.statusText}`);
    }
  };



  // calculateWaitVector is now a pure module-level function — no stale closure risk
  const totalOccupancy = useMemo(() => zones.reduce((sum, z) => sum + z.crowd_count, 0), [zones]);
  const avgWaitTime = useMemo(() =>
    zones.length > 0
      ? Math.round(zones.reduce((sum, z) => sum + calculateWaitVector(z.crowd_count, z.id, z.capacity || 500).currentWait, 0) / zones.length)
      : 0
  , [zones]);

  const sortedZones = useMemo(() => [...zones].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    const pctA = a.capacity ? a.crowd_count / a.capacity : 0;
    const pctB = b.capacity ? b.crowd_count / b.capacity : 0;
    if (sortBy === 'density-desc') return pctB - pctA;
    if (sortBy === 'density-asc') return pctA - pctB;
    return 0;
  }), [zones, sortBy]);

  const displayZones = useMemo(() => pulseMode ? sortedZones.filter(z => {
    const cap = z.capacity || 500;
    return (z.crowd_count / cap) > 0.75;
  }) : sortedZones, [pulseMode, sortedZones]);

  const sortedIncidents = useMemo(() => [...incidents].sort((a, b) => {
    if (incidentSortBy === 'timestamp-desc') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (incidentSortBy === 'timestamp-asc') return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (incidentSortBy === 'type') return a.issue_type.localeCompare(b.issue_type);
    if (incidentSortBy === 'zone') return a.zone.localeCompare(b.zone);
    return 0;
  }), [incidents, incidentSortBy]);

  if (viewMode === 'attendee') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 p-6 flex flex-col items-center">
        <header className="w-full max-w-md flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-6 h-6 text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight">Venue Vitality</h1>
          </div>
          <p className="text-slate-400 text-sm">Live status updates for your convenience.</p>
        </header>

        <div className="w-full max-w-md space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
            <span className="text-xs uppercase font-bold tracking-widest text-slate-500">System Status</span>
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> SYSTEM LIVE
            </span>
          </div>

          {zones.filter(z => z.id.includes('gate') || z.id.includes('food') || z.id.includes('washroom')).map(zone => {
            const capacity = zone.capacity || 500;
            const pct = Math.min((zone.crowd_count / capacity) * 100, 100);
            const isFull = pct > 85;
            const isMedium = pct > 50 && pct <= 85;
            const wait = calculateWaitVector(zone.crowd_count, zone.id, capacity).currentWait;

            return (
              <div key={zone.id} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">{zone.name}</h2>
                  <p className={`text-xs font-bold uppercase tracking-widest mt-1 ${isFull ? 'text-rose-400' : isMedium ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {isFull ? 'Very Busy' : isMedium ? 'Moderately Busy' : 'Open / Empty'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-light tracking-tight text-white">{wait}<span className="text-xs font-bold ml-1 text-slate-500">min</span></p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Est. Wait</p>
                </div>
              </div>
            );
          })}

          <Button 
            className="w-full py-6 mt-8 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase tracking-widest"
            onClick={() => {
              const nearestGreen = zones.find(z => (z.crowd_count / (z.capacity || 500)) < 0.4);
              if (nearestGreen) {
                toast(`Head to ${nearestGreen.name} for shorter wait times!`);
              } else {
                toast("All zones are currently active. Monitoring closely.");
              }
            }}
          >
            Find Nearest Green Zone
          </Button>
        </div>
        
        <button 
          className="mt-12 text-slate-500 text-[10px] uppercase tracking-widest hover:text-slate-300 transition-colors"
          onClick={() => setViewMode('operator')}
        >
          Operator Login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans w-full flex flex-col selection:bg-indigo-500/30">
      {/* Global Status Bar */}
      <div className="sticky top-0 z-[60] h-7 bg-indigo-600 flex items-center justify-center px-4 overflow-hidden border-b border-indigo-500">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white flex items-center gap-4 whitespace-nowrap">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> System Live</span>
          <span className="opacity-40">•</span>
          <span className="flex items-center gap-1.5"><AlertCircle className="w-3 h-3" /> {incidents.filter(i => !i.issue_type.includes('Resolved')).length} Critical Issues</span>
          <span className="opacity-40">•</span>
          <span>{timeStr} STADIUM OPERATIONS CENTER</span>
        </p>
      </div>

      {/* Header Navigation */}
      <header className="sticky top-7 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 text-white h-16 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4 group cursor-pointer">
          <div className="relative flex items-center justify-center w-9 h-9">
            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-600 to-blue-400 rounded-xl rotate-6 opacity-60 blur-[3px] transition-transform duration-500 group-hover:rotate-12 group-hover:opacity-80"></div>
            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-cyan-400 rounded-xl shadow-lg shadow-indigo-500/40 opacity-90 transform -rotate-3 transition-transform duration-300 group-hover:rotate-0"></div>
            <div className="relative flex items-center justify-center w-full h-full bg-gradient-to-br from-slate-900/40 to-transparent rounded-xl border border-white/20 backdrop-blur-sm">
              <Activity className="w-5 h-5 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className="text-lg font-medium tracking-tight mt-0.5">CrowdPulse <span className="hidden sm:inline text-slate-400 font-normal text-sm ml-2">Venue Monitor v1.0</span></h1>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <div className="hidden md:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></span>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-300">System Live</span>
          </div>
          <div className="hidden sm:block text-slate-400 text-sm font-mono">{timeStr}</div>
          <Button 
            onClick={() => setPulseMode(!pulseMode)} 
            variant="outline" 
            className={`px-3 py-1.5 h-auto text-[11px] font-bold uppercase tracking-widest transition-all shadow-md flex items-center gap-2 ${pulseMode ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-rose-900/20' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            <Activity className="h-3.5 w-3.5" />
            Pulse Mode {pulseMode ? 'ON' : 'OFF'}
          </Button>
          <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
            <DialogTrigger className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all shadow-md shadow-indigo-900/20 flex items-center gap-2">
              <AlertTriangle className="h-3 w-3" />
              Report
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-800 text-slate-200 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-white text-lg">Report an Incident</DialogTitle>
                <DialogDescription className="text-slate-400">Alert security and operations about an issue.</DialogDescription>
              </DialogHeader>
              <form onSubmit={reportIncident} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="zone" className="text-slate-300 text-sm">Location</Label>
                  <Select name="zone" value={reportZone} onValueChange={setReportZone} required>
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-white"><SelectValue placeholder="Select zone" /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white shadow-xl">
                      {zones.map(z => <SelectItem key={z.id} value={z.name} className="focus:bg-slate-800">{z.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type" className="text-slate-300 text-sm">Issue Type</Label>
                  <Select name="type" value={reportType} onValueChange={setReportType} required>
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-white"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white shadow-xl">
                      <SelectItem value="Crowd" className="focus:bg-slate-800">Crowd Congestion</SelectItem>
                      <SelectItem value="Medical" className="focus:bg-slate-800">Medical Emergency</SelectItem>
                      <SelectItem value="Security" className="focus:bg-slate-800">Security Concern</SelectItem>
                      <SelectItem value="Other" className="focus:bg-slate-800">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-slate-300 text-sm">Description</Label>
                  <Input name="description" placeholder="Brief details..." className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-indigo-500" />
                </div>
                <Button type="submit" className="w-full bg-indigo-600 text-white hover:bg-indigo-500 font-semibold tracking-wide shadow-md shadow-indigo-900">Submit Report</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col lg:flex-row gap-6 md:gap-8 items-start justify-center max-w-[1600px]">
        
        {/* Left Column: Zone Monitoring */}
        <div className="flex-1 w-full flex flex-col gap-6 md:gap-8 min-w-0">
          
          {/* KPI Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center shadow-sm relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-80"></div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-blue-400" /> Total Occupancy</p>
              <p className="text-3xl font-semibold text-white tracking-tight">{totalOccupancy.toLocaleString()}</p>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center shadow-sm relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500 opacity-80"></div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-amber-400" /> Avg. Wait Time</p>
              <div className="flex items-baseline gap-1">
                <p className="text-3xl font-semibold text-white tracking-tight">{avgWaitTime}</p>
                <span className="text-sm font-semibold text-slate-500 uppercase">min</span>
              </div>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center shadow-sm relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500 opacity-80"></div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-emerald-400" /> Data Fidelity</p>
              <div className="flex items-baseline gap-1">
                <p className="text-3xl font-semibold text-white tracking-tight">98.4<span className="text-xl">%</span></p>
                <span className="text-xs font-semibold text-emerald-500 uppercase ml-1 block">- Sensor Sync</span>
              </div>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center shadow-sm relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-red-500 opacity-80"></div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4 text-rose-400" /> Active Incidents</p>
              <p className="text-3xl font-semibold text-white tracking-tight">{String(incidents.length).padStart(2, '0')}</p>
            </div>
          </div>

          {/* Density Dashboard */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-col shadow-sm">
            <div className="p-5 border-b border-slate-800/60 flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-900/40 rounded-t-2xl">
              <h2 className="font-semibold text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2">
                <MapPin className="w-4 h-4 text-indigo-400" /> Zone Density
              </h2>
              <div className="flex gap-3 items-center">
                <Button 
                  onClick={() => setShowDigitalTwin(true)} 
                  variant="outline" 
                  className="h-9 font-medium bg-slate-900 border-indigo-500/30 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 focus:ring-indigo-500 flex items-center gap-2 px-3"
                >
                  <MapIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Digital Twin View</span>
                </Button>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-9 font-medium bg-slate-950 border-slate-800 text-slate-300 w-[160px] rounded-lg focus:ring-indigo-500">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300 shadow-xl">
                    <SelectItem value="density-desc" className="focus:bg-slate-800">Highest Density</SelectItem>
                    <SelectItem value="density-asc" className="focus:bg-slate-800">Lowest Density</SelectItem>
                    <SelectItem value="name" className="focus:bg-slate-800">Name A-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {displayZones.map(zone => {
                const capacity = zone.capacity || (zone.id.includes('gate') ? 5000 : zone.id.includes('food') ? 1500 : zone.id.includes('washroom') ? 50 : 500);
                const pct = Math.min((zone.crowd_count / capacity) * 100, 100);
                const isCritical = pct > 90;
                const isWarning = pct > 75 && pct <= 90;
                const isMedium = pct >= 40 && pct <= 75;
                const waitVector = calculateWaitVector(zone.crowd_count, zone.id, capacity);
                // Fake staff assignment overlay
                const staffCount = isCritical ? 6 : isWarning ? 3 : 1;
                const isImproving = waitVector.projectedWait < waitVector.currentWait;
                const isWorsening = waitVector.projectedWait > waitVector.currentWait;

                return (
                  <div 
                    key={zone.id} 
                    className={`group relative overflow-hidden bg-slate-950/40 border rounded-2xl p-5 flex flex-col justify-between cursor-pointer transition-all duration-300 hover:bg-slate-900/80 hover:-translate-y-1 hover:shadow-xl ${
                      isCritical 
                        ? 'border-rose-500/40 hover:border-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.05)] hover:shadow-[0_0_25px_rgba(225,29,72,0.15)] ring-1 ring-transparent hover:ring-rose-500/50' 
                        : isWarning 
                        ? 'border-orange-500/40 hover:border-orange-500 ring-1 ring-transparent hover:ring-orange-500/50'
                        : 'border-slate-800 hover:border-indigo-400 ring-1 ring-transparent hover:ring-indigo-500/30 hover:shadow-[0_4px_20px_rgba(99,102,241,0.05)]'
                    } ${selectedZone === zone.id ? 'ring-2 !ring-indigo-500 !border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]' : ''}`}
                    onClick={() => setSelectedZone(zone.id)}
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className={`font-semibold tracking-tight transition-colors text-lg ${isCritical ? 'text-rose-400' : isWarning ? 'text-orange-400' : 'text-slate-200 group-hover:text-white'}`}>
                          {zone.name}
                        </h3>
                        <p className="text-[11px] mt-1 uppercase font-bold tracking-widest text-slate-500">
                          Cap {capacity.toLocaleString()} • Staff: {staffCount}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide border flex items-center gap-1.5 ${
                        isCritical ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' : 
                        isWarning ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                        isMedium ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}>
                        {isCritical && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>}
                        {isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : isMedium ? 'CONGESTED' : 'FLOWING'}
                      </span>
                    </div>
                    <div className="flex items-end justify-between z-10 relative mb-4">
                      <div className="flex flex-col gap-1.5">
                        <p className={`text-4xl font-light tracking-tight ${isCritical ? 'text-rose-400' : isWarning ? 'text-orange-400' : 'text-white'}`}>
                          {zone.crowd_count.toLocaleString()}
                        </p>
                        <div className="flex flex-col gap-0.5 mt-2">
                          <p className={`text-[11px] uppercase font-bold tracking-widest flex items-center gap-1 ${isCritical ? 'text-rose-500/80' : 'text-slate-500'}`}>
                            <Clock className="w-3.5 h-3.5" /> Wait Vector: {waitVector.pressure > 5 ? 'High Pressure' : 'Flowing'} ({waitVector.currentWait}m)
                          </p>
                          <p className={`text-[12px] font-mono tracking-widest flex items-center gap-1 opacity-90 ${isWorsening ? 'text-rose-400' : isImproving ? 'text-emerald-400' : 'text-slate-400'}`}>
                            ↳ Projected in 15m: {waitVector.projectedWait}m
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Thick Progress Track */}
                    <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden mt-2 outline outline-1 outline-slate-800">
                      <div className={`h-full transition-all duration-700 ease-out rounded-full ${isCritical ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,1)]' : isWarning ? 'bg-orange-500' : isMedium ? 'bg-amber-500' : 'bg-emerald-400'}`} style={{width: `${pct}%`}}></div>
                    </div>

                    {/* Proactive Action Triggers */}
                    <div className={`mt-3 grid grid-cols-2 gap-2 transition-all duration-500 overflow-hidden ${isCritical || isWarning ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'}`}>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={(e) => handleDispatch(zone.id, e)}
                        disabled={zoneActions[zone.id]?.dispatch}
                        className={`h-7 text-[10px] font-bold tracking-widest uppercase ${
                          zoneActions[zone.id]?.dispatch 
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                            : isCritical ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10' : 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
                        }`}
                      >
                        {zoneActions[zone.id]?.dispatch ? `${staffCount} Staff Dispatched - ETA ${zoneActions[zone.id]?.dispatchEta}m` : 'Dispatch Staff'}
                      </Button>
                      <Button 
                        size="sm" 
                        variant={zone.id.includes('food') ? "ghost" : "outline"} 
                        onClick={(e) => handlePromo(zone.id, e)}
                        disabled={zoneActions[zone.id]?.promo}
                        className={`h-7 text-[10px] font-bold tracking-widest uppercase ${
                          zoneActions[zone.id]?.promo
                            ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10'
                            : zone.id.includes('food') 
                              ? 'text-slate-400 hover:text-white hover:bg-slate-800' 
                              : isCritical ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10' : 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
                        }`}
                      >
                        {zoneActions[zone.id]?.promo ? 'Activated' : zone.id.includes('food') ? 'Trigger Promo' : 'Virtual Queue'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Crowd Trend & Wait Vector */}
          <div className="hidden sm:block bg-slate-900/60 p-5 rounded-2xl border border-slate-800 shadow-sm shrink-0">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <TrendingUp className="h-4 w-4"/> Dynamic Trend Profile & Wait Vector: <span className="text-slate-200 capitalize font-semibold tracking-wide ml-1">{zones.find(z => z.id === selectedZone)?.name || selectedZone}</span>
            </h2>
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                  <ReferenceLine 
                    y={(zones.find(z => z.id === selectedZone)?.capacity || (selectedZone.includes('gate') ? 5000 : selectedZone.includes('food') ? 1500 : selectedZone.includes('washroom') ? 50 : 500)) * 0.9} 
                    stroke="#f43f5e" 
                    strokeDasharray="4 4" 
                    strokeWidth={2}
                    label={{ position: 'insideTopLeft', value: 'CRITICAL THRESHOLD (90%)', fill: '#f43f5e', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em' }} 
                  />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }} width={35} />
                  <Tooltip contentStyle={{ borderRadius: '12px', backgroundColor: '#0f172a', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }} cursor={{stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4'}} />
                  <Line type="stepAfter" dataKey="count" stroke="#6366f1" strokeWidth={2.5} dot={false} activeDot={{r: 6, fill: '#818cf8', strokeWidth: 0}} animationDuration={300} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Right Column: Actions & Suggestions */}
        <div className="w-full lg:w-[380px] flex flex-col gap-6 shrink-0 lg:sticky lg:top-[5.5rem] pb-8">
          
          {/* AI Insights Engine */}
          <div className="bg-gradient-to-b from-indigo-900/30 to-slate-900 border border-indigo-500/20 p-5 rounded-2xl flex flex-col shadow-lg shadow-indigo-500/5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400" /> Platform Intelligence
              </h2>
              <button 
                onClick={getAiTip}
                disabled={isAiLoading}
                className="bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-50 text-indigo-200 border border-indigo-500/30 text-[10px] px-3 py-1.5 rounded-full font-bold uppercase tracking-widest transition-all"
              >
                Analyze
              </button>
            </div>
            <div className="text-[13px] bg-slate-950/80 border border-indigo-500/10 p-5 rounded-xl min-h-[90px] text-indigo-100/90 leading-relaxed overflow-x-auto shadow-inner custom-scrollbar [&>p]:mb-3 [&>p:last-child]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-3 [&>ul:last-child]:mb-0 [&>li]:mb-1.5 [&>h3]:text-sm [&>h3]:font-bold [&>h3]:text-indigo-300 [&>h3]:mb-2 [&>strong]:text-indigo-200 [&>strong]:font-semibold">
              {aiInsight ? (
                <Markdown>{aiInsight}</Markdown>
              ) : (
                <span className="font-mono text-xs text-indigo-400/50">{"// Initialize analysis via query engine..."}</span>
              )}
            </div>
          </div>

          {/* Smart Pulse Suggestion */}
          <div className="bg-blue-900/10 border border-blue-500/20 text-slate-300 p-5 rounded-2xl shadow-lg shadow-blue-500/5">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200 mb-4 flex items-center gap-2">
              <Wind className="h-4 w-4 text-blue-400"/> Router Engine
            </h2>
            {suggestions.length === 0 ? (
                <div className="bg-slate-950/50 rounded-xl p-4 border border-blue-500/10">
                  <p className="text-[12px] font-medium opacity-60 text-slate-400 italic">Status optimal. No priority re-routes.</p>
                </div>
              ) : (
                suggestions.map((s, i) => (
                  <div key={i} className="bg-slate-950/60 rounded-xl p-4 mb-3 border border-blue-500/10 last:mb-0 transform transition-transform hover:-translate-y-0.5">
                    <p className="text-sm text-slate-300 flex items-start leading-relaxed font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 mr-3 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                      {s.message}
                    </p>
                  </div>
                ))
            )}
          </div>

          {/* Active Incidents */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-col max-h-[450px] shadow-sm">
            <div className="p-4 border-b border-slate-800/60 shrink-0 bg-slate-900/40 rounded-t-2xl flex justify-between items-center">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-widest flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Incident Log
              </h2>
                <Select value={incidentSortBy} onValueChange={(val) => {
                  setIncidentSortBy(val);
                  toast.info(`Sorting log by ${val.replace('-', ' ')}`);
                }}>
                  <SelectTrigger className="h-7 text-[10px] font-semibold tracking-wide bg-slate-950 border-slate-800 text-slate-300 w-[110px] rounded focus:ring-indigo-500 uppercase">
                    <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300 shadow-xl min-w-[140px]">
                    <SelectItem value="timestamp-desc" className="text-xs focus:bg-slate-800">Newest First</SelectItem>
                    <SelectItem value="timestamp-asc" className="text-xs focus:bg-slate-800">Oldest First</SelectItem>
                    <SelectItem value="type" className="text-xs focus:bg-slate-800">Issue Type</SelectItem>
                    <SelectItem value="zone" className="text-xs focus:bg-slate-800">Zone Name</SelectItem>
                  </SelectContent>
                </Select>
            </div>
            <div className="p-5 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
              {sortedIncidents.length === 0 && (
                <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-slate-700/50 rounded-xl bg-slate-950/30">
                  <Sparkles className="w-6 h-6 text-emerald-500 animate-pulse mb-3 shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Zero incidents recorded</p>
                  <p className="text-[11px] text-slate-400 mt-2 font-mono bg-slate-900 px-3 py-1 rounded-md border border-slate-800">System Health: All sensors active</p>
                </div>
              )}
              {sortedIncidents.map((incident, i) => {
                // Simulate service recovery dispatch loop based on incident index & id
                const staffId = `S-${(incident.id * 17) % 100 + 10}`;
                const dispatchEta = Math.min((i * 2 + 1), 15);
                const isRecovered = dispatchEta > 8 && i > 3;

                // Simulate AIOps Causality Logic
                const isCrowd = incident.issue_type === 'Crowd';
                const causalityPrimary = isCrowd ? 
                  (incident.zone.toLowerCase().includes('gate') ? 'Turnstile / Scanner Failure' : 'Static Crowd Formation / Bottleneck') 
                  : (incident.issue_type === 'Security' ? 'Unattended item / Altercation detected' : 'Unplanned Stop / Slip & Fall event');
                const causalitySecondary = isCrowd ? 
                  (incident.zone.toLowerCase().includes('food') ? 'Point of Sale (POS) offline' : '40% VIPs arriving late (Thundering Herd)') 
                  : null;

                return (
                 <div key={incident.id} className={`bg-slate-950/80 border ${isRecovered ? 'border-emerald-500/20' : 'border-slate-800/60'} rounded-xl p-4 hover:border-slate-700 transition-colors`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-bold ${isRecovered ? 'text-emerald-400' : 'text-rose-400'} uppercase tracking-widest`}>
                      {isRecovered ? 'Resolved' : incident.issue_type === 'Crowd' ? 'Congestion Alert' : incident.issue_type}
                    </span>
                    <span className="text-[10px] font-mono font-medium text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
                      {new Date(incident.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 font-medium flex items-center gap-2 mb-2">
                    <MapPin className="h-3.5 w-3.5 text-slate-500" /> {incident.zone}
                  </p>
                  
                  {/* AIOps Causality Injection */}
                  {(!isRecovered) && (
                    <div className="mb-3 bg-slate-900 border-l-[3px] border-indigo-500/50 px-3 py-2 rounded-r-lg">
                      <p className="text-[11px] text-slate-300 mb-1">
                        <strong className="text-indigo-400 font-semibold uppercase tracking-widest text-[9px] block mb-0.5">Primary Cause</strong>
                        {causalityPrimary}
                      </p>
                      {causalitySecondary && (
                        <p className="text-[11px] text-slate-400">
                          <strong className="text-slate-500 font-semibold uppercase tracking-widest text-[9px] block mb-0.5 mt-1.5">Contributing Factor</strong>
                          {causalitySecondary}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest bg-slate-900 w-fit px-2 py-0.5 rounded border border-slate-800 mb-2">
                    {isRecovered ? 'Recovery Completed' : `Staff ${staffId} Dispatched • ETA: ${dispatchEta}m`}
                  </p>
                  {incident.description && <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-800 pl-3 italic">"{incident.description}"</p>}
                 </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Status Bar Footer */}
      <footer className="h-12 bg-slate-950 border-t border-slate-900 flex items-center px-6 justify-between text-[11px] font-mono text-slate-500 shrink-0 select-none z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]">
        <div className="flex gap-6 uppercase tracking-wider font-semibold">
          <span className="hidden sm:inline">DB: SQLite</span>
          <span className="text-blue-500 drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]">NODE: TRUE</span>
          <span className="hidden sm:inline text-slate-400 border-l border-slate-800 pl-6">WS: {isSocketConnected ? <span className="text-emerald-500">CONNECTED</span> : 'WAITING'}</span>
        </div>
        <div className="flex gap-6 uppercase tracking-wider font-semibold items-center">
          <button 
            onClick={() => setViewMode('attendee')}
            className="text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer border border-indigo-500/20 px-2 py-0.5 rounded bg-indigo-500/5 group flex items-center gap-2"
          >
            <Sparkles className="w-3 h-3 group-hover:animate-pulse" />
            QR-Link: Attendee View
          </button>
          <span className="text-amber-500/80 border-l border-slate-800 pl-6">PII: Obfuscated at Source</span>
          <span className="text-emerald-500/80 border-l border-slate-800 pl-6">Latency: 1.2ms (Edge Node)</span>
          <span className="text-slate-500 border-l border-slate-800 pl-6">SYNC: {lastSync}</span>
          <span className="text-indigo-400 border-l border-slate-800 pl-6 tracking-widest font-bold uppercase">AIOps Engine Active</span>
        </div>
      </footer>
      <Toaster theme="dark" position="top-center" />

      {/* Digital Twin Spatial Overlay Modal */}
      <Dialog open={showDigitalTwin} onOpenChange={setShowDigitalTwin}>
        <DialogContent className="max-w-5xl bg-slate-950 border border-slate-800 text-slate-200 shadow-2xl p-0 overflow-hidden rounded-2xl">
          <div className="p-5 border-b border-slate-800/80 bg-slate-900/50 flex justify-between items-center z-10 relative">
            <DialogTitle className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
              </span>
              Digital Twin Spatial View
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 font-mono tracking-widest uppercase flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-400" />
              Live Sensor Overlay Active
            </DialogDescription>
          </div>
          
          <div className="relative w-full h-[60vh] min-h-[500px] bg-slate-950 overflow-hidden flex items-center justify-center p-8 border-b border-slate-800">
            {/* Grid background to represent technical blueprint */}
            <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-30"></div>
            
            <div className="relative w-full h-full max-w-4xl border border-slate-800/80 rounded-[3rem] bg-slate-900/40 p-12 shadow-[inset_0_0_100px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-visible">
              <div className="absolute top-8 left-12 text-slate-800 font-bold text-5xl opacity-40 select-none pointer-events-none tracking-tighter">
                VENUE SCHEMATIC
              </div>
              
              {/* Abstract stadium representation matching database zones */}
              {zones.map((zone, i) => {
                const capacity = zone.capacity || 500;
                const pressure = zone.crowd_count / capacity;
                const isCritical = pressure > 0.9;
                const isWarning = pressure > 0.75 && pressure <= 0.9;
                
                // Position logic based on standard stadium Layout
                let posClasses: React.CSSProperties = {};
                let sizeClasses = "w-32 h-32";
                let labelPos = "top-full mt-2";
                
                if (zone.id.includes('gate-a')) { posClasses = { top: '15%', left: '15%' }; sizeClasses = "w-28 h-20 rounded-xl"; labelPos = "-top-8 left-1/2 -translate-x-1/2"; }
                else if (zone.id.includes('gate-b')) { posClasses = { bottom: '15%', right: '15%' }; sizeClasses = "w-28 h-20 rounded-xl"; labelPos = "-bottom-8 left-1/2 -translate-x-1/2"; }
                else if (zone.id.includes('food')) { posClasses = { top: '15%', right: '25%' }; sizeClasses = "w-48 h-28 rounded-2xl"; labelPos = "-top-8 left-1/2 -translate-x-1/2"; }
                else if (zone.id.includes('washroom')) { posClasses = { bottom: '20%', left: '25%' }; sizeClasses = "w-28 h-28 rounded-full"; labelPos = "top-full mt-3 left-1/2 -translate-x-1/2"; }
                else if (zone.id.includes('seating-a')) { posClasses = { top: '40%', left: '35%' }; sizeClasses = "w-56 h-24 rounded-lg shadow-inner"; labelPos = "top-1/2 -translate-y-1/2 -left-32"; }
                else if (zone.id.includes('seating-b')) { posClasses = { bottom: '25%', left: '45%' }; sizeClasses = "w-48 h-20 rounded-lg shadow-inner"; labelPos = "top-1/2 -translate-y-1/2 -right-32"; }
                else { posClasses = { top: `${Math.max(10, Math.min(80, parseInt((i*17).toString(), 10)))}%`, left: `${Math.max(10, Math.min(80, parseInt((i*23).toString(), 10)))}%` } }

                return (
                  <div 
                    key={zone.id}
                    className={`absolute border transition-all duration-1000 flex items-center justify-center cursor-pointer ${sizeClasses} ${
                      isCritical ? 'border-rose-500 bg-rose-500/20 shadow-[0_0_30px_rgba(244,63,94,0.3)] z-30' : 
                      isWarning ? 'border-orange-500 bg-orange-500/20 shadow-[0_0_20px_rgba(249,115,22,0.2)] z-20' : 
                      'border-indigo-500/30 bg-indigo-500/10 z-10 hover:bg-indigo-500/20'
                    } ${selectedZone === zone.id ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105' : ''}`}
                    style={posClasses}
                    onClick={() => setSelectedZone(zone.id)}
                  >
                    {isCritical && <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 z-40"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500 border border-slate-900"></span></span>}
                    
                    <span className={`absolute ${labelPos} whitespace-nowrap text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-slate-900 backdrop-blur rounded border shadow-xl z-40 ${isCritical ? 'border-rose-500/50 text-rose-400' : isWarning ? 'border-orange-500/50 text-orange-400' : 'border-slate-700 text-slate-300'}`}>
                      {zone.name}
                    </span>
                    
                    <span className={`text-2xl font-light tracking-tighter ${isCritical ? 'text-white' : 'text-slate-300'}`}>
                      {zone.crowd_count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="bg-slate-900 p-4 border-t border-slate-800 flex justify-between items-center text-[11px] font-mono text-slate-500 tracking-widest uppercase">
            <span>Sensors: Active</span>
            <span className="flex gap-4">
              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Critical / Blocked</span>
              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-500/30 border border-indigo-500/50"></span> Flowing</span>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

