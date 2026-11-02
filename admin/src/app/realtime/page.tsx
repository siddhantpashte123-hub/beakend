'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Radio, Send, RefreshCw, Plus, Wifi, WifiOff } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, useToast } from '@/components/ui';
import { apiFetch, getRealtimeWsUrl } from '@/lib/api';

interface ChannelStat {
  name: string;
  subscribers: number;
}

export default function RealtimePage() {
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  const [connections, setConnections] = useState(0);
  const [channels, setChannels] = useState<ChannelStat[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  // Live inspector subscriptions
  const [subInput, setSubInput] = useState('custom:playground');
  const [subscribed, setSubscribed] = useState<string[]>(['custom:playground', 'db:todos']);
  const [frames, setFrames] = useState<Array<{ id: number; raw: any }>>([]);

  // Test publisher form
  const [pubChannel, setPubChannel] = useState('custom:playground');
  const [pubEvent, setPubEvent] = useState('custom.message');
  const [pubPayload, setPubPayload] = useState('{\n  "greeting": "Hello from BlueBeakend Realtime!",\n  "ts": 1\n}');

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ connections: number; channels: ChannelStat[] }>('/api/v1/admin/realtime/stats');
      setConnections(res.connections);
      setChannels(res.channels);
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    const url = getRealtimeWsUrl();
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ['custom:playground', 'db:todos'].forEach((ch) => {
        ws.send(JSON.stringify({ action: 'subscribe', channel: ch }));
      });
      setTimeout(loadStats, 200);
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data));
        if (parsed.event === 'connected' || parsed.event === 'subscribed') {
          loadStats();
          return;
        }
        setFrames((prev) => [{ id: Date.now() + Math.random(), raw: parsed }, ...prev.slice(0, 99)]);
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => setWsConnected(false);
    const interval = setInterval(loadStats, 5000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadStats]);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    const ch = subInput.trim();
    if (!ch || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ action: 'subscribe', channel: ch }));
    if (!subscribed.includes(ch)) setSubscribed((s) => [...s, ch]);
    setSubInput('');
    setTimeout(loadStats, 150);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = JSON.parse(pubPayload);
      await apiFetch('/api/v1/admin/realtime/publish', {
        method: 'POST',
        body: { channel: pubChannel.trim(), event: pubEvent.trim() || 'custom.message', payload },
      });
      toast('Broadcast sent!', { description: `Channel: ${pubChannel}`, variant: 'success' });
      loadStats();
    } catch (err: any) {
      toast('Publish failed', { description: err.message, variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Realtime Hub</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Monitor WebSocket connections, active channels, and test pub/sub broadcasts live.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge variant={wsConnected ? 'success' : 'warning'} className="px-3 py-1">
            {wsConnected ? <Wifi className="h-3.5 w-3.5 mr-1.5" /> : <WifiOff className="h-3.5 w-3.5 mr-1.5" />}
            {wsConnected ? 'Console Stream Connected' : 'Connecting…'}
          </Badge>
          <Button size="sm" variant="outline" onClick={loadStats}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stat Cards + Active Channels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 flex flex-col justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Connections</p>
            <p className="text-4xl font-bold mt-2 text-[#0066FF]">{connections}</p>
            <p className="text-xs text-slate-400 mt-1">Active WebSocket sockets across cluster</p>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Active Channels ({channels.length})
            </p>
            {channels.length === 0 ? (
              <p className="text-xs text-slate-400">No active channel subscriptions.</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {channels.map((ch) => (
                  <div
                    key={ch.name}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 text-xs"
                  >
                    <span className="font-mono truncate">{ch.name}</span>
                    <Badge variant="blue">{ch.subscribers} sub</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Test Message Sender */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Test Message Sender</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePublish} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Channel</label>
                  <Input
                    required
                    value={pubChannel}
                    onChange={(e) => setPubChannel(e.target.value)}
                    placeholder="db:todos or custom:room1"
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Event Name</label>
                  <Input
                    required
                    value={pubEvent}
                    onChange={(e) => setPubEvent(e.target.value)}
                    placeholder="custom.message"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">JSON Payload</label>
                <textarea
                  rows={4}
                  value={pubPayload}
                  onChange={(e) => setPubPayload(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit">
                  <Send className="h-4 w-4" /> Broadcast Event
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Live Incoming Event Stream */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[#0066FF]" /> Live Event Inspector
            </CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">
              Listening on: {subscribed.map((c) => ` ${c}`).join(',')}
            </p>
          </div>
          <form onSubmit={handleSubscribe} className="flex items-center gap-2">
            <Input
              placeholder="Subscribe channel (e.g. db:products)"
              value={subInput}
              onChange={(e) => setSubInput(e.target.value)}
              className="w-56 text-xs font-mono"
            />
            <Button type="submit" size="sm" variant="secondary">
              <Plus className="h-3.5 w-3.5" /> Listen
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 h-72 overflow-y-auto font-mono text-xs space-y-2">
            {frames.length === 0 ? (
              <p className="text-slate-500">
                Waiting for realtime events… Click &quot;Broadcast Event&quot; above or create/edit a document in{' '}
                <span className="text-slate-300">todos</span>!
              </p>
            ) : (
              frames.map((f) => (
                <div key={f.id} className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-slate-200">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>
                      <strong className="text-[#4d94ff]">{f.raw.event}</strong> on{' '}
                      <span className="text-emerald-400">{f.raw.channel}</span>
                    </span>
                    <span>{f.raw.ts}</span>
                  </div>
                  <pre className="text-slate-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(f.raw.payload, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
