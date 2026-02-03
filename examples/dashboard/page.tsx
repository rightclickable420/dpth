'use client';

import { useEffect, useState } from 'react';

interface NetworkStatus {
  network: {
    name: string;
    version: string;
    uptime: string;
  };
  agents: {
    total: number;
    online: number;
    busy: number;
    totalStorageMb: number;
    totalCpuCores: number;
    gpuAgents: number;
    totalVramGb: number;
  };
  tasks: {
    pending: number;
    claimed: number;
    completedTotal: number;
    failedTotal: number;
    throughputPerHour: number;
  };
  storage: {
    totalChunks: number;
    totalMb: number;
    hotMb: number;
    warmMb: number;
    coldMb: number;
  };
  contributions: {
    storageContributors: number;
    computeContributors: number;
    gpuContributors: number;
    totalStorageContributed: number;
    totalComputeTasks: number;
    totalGpuTasks: number;
    tokensGenerated: number;
    imagesGenerated: number;
  };
  intelligence: {
    entitiesTracked: number;
    metricsTracked: number;
    correlationsFound: number;
    patternsDetected: number;
  };
}

function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
        {title}
      </div>
      <div className="text-2xl font-bold text-gray-900">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-400 mt-1">
          {subtitle}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
      {children}
    </h2>
  );
}

export default function NetworkDashboard() {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/dpth/status');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-gray-400">Loading network status...</div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-red-500">Error: {error || 'Unknown error'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-2xl font-bold text-gray-900">dpth.io Network</h1>
          </div>
          <p className="text-gray-500">
            Decentralized intelligence layer — {status.network.version}
          </p>
        </div>

        {/* Agents Section */}
        <section className="mb-8">
          <SectionHeader>
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            Agent Network
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            <StatCard title="Total Agents" value={status.agents.total} />
            <StatCard 
              title="Online" 
              value={status.agents.online}
              subtitle={`${Math.round(status.agents.online / Math.max(1, status.agents.total) * 100)}%`}
            />
            <StatCard title="Busy" value={status.agents.busy} />
            <StatCard 
              title="Storage" 
              value={`${Math.round(status.agents.totalStorageMb / 1024)} GB`}
              subtitle="capacity"
            />
            <StatCard 
              title="CPU Cores" 
              value={status.agents.totalCpuCores}
              subtitle="available"
            />
            <StatCard 
              title="GPU Agents" 
              value={status.agents.gpuAgents}
              subtitle="for inference"
            />
            <StatCard 
              title="GPU VRAM" 
              value={`${status.agents.totalVramGb} GB`}
              subtitle="total"
            />
          </div>
        </section>

        {/* Tasks Section */}
        <section className="mb-8">
          <SectionHeader>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Task Queue
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard 
              title="Pending" 
              value={status.tasks.pending}
              subtitle="waiting for agents"
            />
            <StatCard 
              title="In Progress" 
              value={status.tasks.claimed}
              subtitle="being processed"
            />
            <StatCard 
              title="Completed" 
              value={status.tasks.completedTotal.toLocaleString()}
              subtitle="all time"
            />
            <StatCard 
              title="Failed" 
              value={status.tasks.failedTotal}
              subtitle={`${Math.round(status.tasks.failedTotal / Math.max(1, status.tasks.completedTotal + status.tasks.failedTotal) * 100)}% rate`}
            />
          </div>
        </section>

        {/* Storage Section */}
        <section className="mb-8">
          <SectionHeader>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Content-Addressed Storage
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <StatCard 
              title="Total Chunks" 
              value={status.storage.totalChunks.toLocaleString()}
            />
            <StatCard 
              title="Total Size" 
              value={`${status.storage.totalMb} MB`}
            />
            <StatCard 
              title="Hot (SSD)" 
              value={`${status.storage.hotMb} MB`}
              subtitle="fast access"
            />
            <StatCard 
              title="Warm (R2)" 
              value={`${status.storage.warmMb} MB`}
              subtitle="recent data"
            />
            <StatCard 
              title="Cold (IPFS)" 
              value={`${status.storage.coldMb} MB`}
              subtitle="distributed"
            />
          </div>
        </section>

        {/* Contributions Section */}
        <section className="mb-8">
          <SectionHeader>
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            Network Contributions
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
            <StatCard 
              title="Storage" 
              value={status.contributions?.storageContributors || 0}
              subtitle="contributors"
            />
            <StatCard 
              title="Compute" 
              value={status.contributions?.computeContributors || 0}
              subtitle="contributors"
            />
            <StatCard 
              title="GPU" 
              value={status.contributions?.gpuContributors || 0}
              subtitle="contributors"
            />
            <StatCard 
              title="Storage" 
              value={`${status.contributions?.totalStorageContributed || 0} MB`}
              subtitle="contributed"
            />
            <StatCard 
              title="CPU Tasks" 
              value={(status.contributions?.totalComputeTasks || 0).toLocaleString()}
              subtitle="completed"
            />
            <StatCard 
              title="GPU Tasks" 
              value={(status.contributions?.totalGpuTasks || 0).toLocaleString()}
              subtitle="inference"
            />
            <StatCard 
              title="Tokens" 
              value={(status.contributions?.tokensGenerated || 0).toLocaleString()}
              subtitle="generated"
            />
            <StatCard 
              title="Images" 
              value={(status.contributions?.imagesGenerated || 0).toLocaleString()}
              subtitle="generated"
            />
          </div>
        </section>

        {/* Intelligence Section */}
        <section className="mb-8">
          <SectionHeader>
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            Intelligence Layer
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard 
              title="Entities" 
              value={status.intelligence.entitiesTracked.toLocaleString()}
              subtitle="tracked"
            />
            <StatCard 
              title="Metrics" 
              value={status.intelligence.metricsTracked.toLocaleString()}
              subtitle="time-series"
            />
            <StatCard 
              title="Correlations" 
              value={status.intelligence.correlationsFound.toLocaleString()}
              subtitle="discovered"
            />
            <StatCard 
              title="Patterns" 
              value={status.intelligence.patternsDetected.toLocaleString()}
              subtitle="detected"
            />
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 mt-12">
          <p>Uptime: {status.network.uptime}</p>
          <p className="mt-1">
            The distributed intelligence layer for business data
          </p>
        </div>
      </div>
    </div>
  );
}
