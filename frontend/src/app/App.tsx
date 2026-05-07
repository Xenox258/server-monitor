import React, { useEffect, useRef, useState } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Clock,
  Thermometer,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Server,
  Network,
  Fan,
} from "lucide-react";
import Chart from "chart.js/auto";

type Stats = {
  total_memory: number;
  used_memory: number;
  memory_percent: number;
  total_swap: number;
  used_swap: number;
  cpu_count: number;
  cpu_usage: number;
  uptime: number;
  disk_percent: number;
  connection_status: string;
  internet_access: boolean;
  last_internet_check: number;
  last_update: number;
  disks: {
    name: string;
    total_space: number;
    available_space: number;
    used_space: number;
    used_percent: number;
  }[];
  networks: {
    name: string;
    total_received: number;
    total_transmitted: number;
  }[];
  temperatures: {
    label: string;
    temperature: number | null;
  }[];
  history: { cpu: number[]; ram: number[]; disk: number[] };
  temperature_summary: { current: number | null; level: string };
  network_summary: { download_bps: number; upload_bps: number };
  top_processes_cpu: {
    pid: string;
    name: string;
    cpu_usage: number;
    memory: number;
  }[];
  top_processes_memory: {
    pid: string;
    name: string;
    cpu_usage: number;
    memory: number;
  }[];
  docker_containers: {
    name: string;
    status: string;
    cpu_percent: number;
    mem_percent: number;
  }[];
  disk_io_summary: {
    read_bytes: number;
    write_bytes: number;
  };
  top_processes_io: {
    pid: string;
    name: string;
    read_bytes: number;
    write_bytes: number;
  }[];
};

function formatPercent(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `${n.toFixed(1)}%`;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return `${value.toFixed(2)} ${units[i]}`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatTimeAgo(unixSeconds: number) {
  if (!unixSeconds || unixSeconds <= 0) return "Dernier test : jamais";

  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSeconds - unixSeconds);

  if (diff < 60) return `Dernier test : il y a ${diff}s`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `Dernier test : il y a ${minutes} min`;
  const hours = Math.floor(diff / 3600);
  return `Dernier test : il y a ${hours}h`;
}

function formatSpeed(bytesPerSecond: number) {
  const n = Number(bytesPerSecond || 0);
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
}

function normalizeContainerStatus(status: string) {
  const value = (status || "").toLowerCase();
  if (value.includes("running")) return { label: "Running", className: "running" };
  if (value.includes("exited") || value.includes("stopped")) return { label: "Stopped", className: "stopped" };
  return { label: status || "Unknown", className: "other" };
}

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string>("");
  // small ticking state to force re-render every 2s so relative/derived
  // timestamps (e.g. "il y a N s" or formatted last update) refresh
  // even when the fetched `stats` object didn't change.
  const [, setTick] = useState(0);

  const cpuChartRef = useRef<HTMLCanvasElement>(null);
  const ramChartRef = useRef<HTMLCanvasElement>(null);
  const diskChartRef = useRef<HTMLCanvasElement>(null);

  const cpuChart = useRef<Chart | null>(null);
  const ramChart = useRef<Chart | null>(null);
  const diskChart = useRef<Chart | null>(null);
  // Local history for disk I/O rates (read/write).
  const IO_HISTORY_LEN = 60;
  const ioReadRef = useRef<number[]>([]);
  const ioWriteRef = useRef<number[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Stats;
        setStats(data);
        setError("");
      } catch (e: any) {
        setError(e?.message || "Erreur de chargement");
      }
    };

    load();
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, []);

  // force periodic re-render so timestamp texts update live
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!stats) return;

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true, mode: 'index', intersect: false },
      },
      scales: {
        x: {
          display: true,
          ticks: {
            display: false,
            color: '#94a3b8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: { display: false },
        },
        y: {
          display: true,
          min: 0,
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(148,163,184,0.06)' },
        },
      },
      elements: {
        point: { radius: 0 },
        line: { tension: 0.4, borderWidth: 2 },
      },
    };

   const makeChart = (
  ref: React.RefObject<HTMLCanvasElement | null>,
  color: string,
  data: number[],
  labels: string[],
  unit?: string
) => {
  if (!ref.current) return null;
  const chartOptions: any = {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales.y,
        ticks: {
          ...((commonOptions.scales && (commonOptions.scales as any).y && (commonOptions.scales as any).y.ticks) || {}),
          callback: unit
            ? function (value: any) {
                return `${value}${unit}`;
              }
            : undefined,
        },
      },
    },
  };

  return new Chart(ref.current, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: color,
          backgroundColor: (context) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 150);
            gradient.addColorStop(0, `${color}40`);
            gradient.addColorStop(1, `${color}00`);
            return gradient;
          },
          fill: true,
        },
      ],
    },
    options: chartOptions as any,
  });
};

    // helper to push to a fixed-length history
    const pushHistoryValue = (arr: number[], v: number, len: number) => {
      arr.push(v);
      if (arr.length > len) arr.shift();
    };

    cpuChart.current?.destroy();
    ramChart.current?.destroy();
    diskChart.current?.destroy();

const cpuLabels = stats.history.cpu.map((_, i) => String(i + 1));
const ramLabels = stats.history.ram.map((_, i) => String(i + 1));

cpuChart.current = makeChart(cpuChartRef, "#5eead4", stats.history.cpu, cpuLabels, "%");
ramChart.current = makeChart(ramChartRef, "#60a5fa", stats.history.ram, ramLabels, "%");

// Update IO histories (backend values are bytes per second; chart uses KB/s)
  const readB = stats.disk_io_summary.read_bytes || 0;
  const writeB = stats.disk_io_summary.write_bytes || 0;
  pushHistoryValue(ioReadRef.current, readB / 1024, IO_HISTORY_LEN);
  pushHistoryValue(ioWriteRef.current, writeB / 1024, IO_HISTORY_LEN);

const ioLabels = ioReadRef.current.map((_, i) => String(i + 1));

// create dual-line chart for disk I/O with dynamic Y scale and KB/s/MB/s ticks
if (diskChartRef.current) {
  // clone commonOptions deeply to mutate safely
  const diskOptions: any = JSON.parse(JSON.stringify(commonOptions));

  // determine max observed value across both series
  const maxVal = Math.max(...(ioReadRef.current.length ? ioReadRef.current : [0]), ...(ioWriteRef.current.length ? ioWriteRef.current : [0]), 1);
  // suggest a comfortable max (20% headroom)
  diskOptions.scales.y.suggestedMax = Math.ceil(maxVal * 1.2);

  // format ticks as KB/s/MB/s
  diskOptions.scales.y.ticks.callback = function (v: any) {
    const n = Number(v || 0);
    if (n >= 1024) return `${(n / 1024).toFixed(1)} MB/s`;
    return `${n.toFixed(0)} KB/s`;
  };

  diskChart.current = new Chart(diskChartRef.current, {
    type: "line",
    data: {
      labels: ioLabels,
      datasets: [
        {
          label: "Read",
          data: ioReadRef.current,
          borderColor: "#60a5fa",
          backgroundColor: "rgba(96,165,250,0.12)",
          fill: true,
        },
        {
          label: "Write",
          data: ioWriteRef.current,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.12)",
          fill: true,
        },
      ],
    },
    options: diskOptions,
  });
}

    return () => {
      cpuChart.current?.destroy();
      ramChart.current?.destroy();
      diskChart.current?.destroy();
    };
  }, [stats]);

  const topCpu = stats?.top_processes_cpu ?? [];
  const topRam = stats?.top_processes_memory ?? [];
  const topIo = stats?.top_processes_io ?? [];
  const dockerContainers = stats?.docker_containers ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              <Server className="h-6 w-6 text-teal-400" />
              Server Monitor
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Dashboard système local — mise à jour automatique toutes les 2 secondes
            </p>
          </div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
            {error}
          </div>
        ) : null}

        <main className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6 xl:gap-6">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Cpu className="h-4 w-4 text-teal-400" /> CPU utilisé
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight text-white">
                  {stats ? formatPercent(stats.cpu_usage) : "--"}
                </div>
                <div className="mt-1 text-sm text-slate-500">Usage global processeur</div>
              </div>
              <div className="mt-auto pt-4">
                <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800/50 bg-slate-950/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-300"
                    style={{ width: `${stats?.cpu_usage ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <MemoryStick className="h-4 w-4 text-blue-400" /> RAM utilisée
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight text-white">
                  {stats ? formatPercent(stats.memory_percent) : "--"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {stats ? `${formatBytes(stats.used_memory)} / ${formatBytes(stats.total_memory)}` : "--"}
                </div>
              </div>
              <div className="mt-auto pt-4">
                <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800/50 bg-slate-950/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400"
                    style={{ width: `${stats?.memory_percent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <HardDrive className="h-4 w-4 text-purple-400" /> Disque utilisé
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight text-white">
                  {stats ? formatPercent(stats.disk_percent) : "--"}
                </div>
                <div className="mt-1 text-sm text-slate-500">Occupation moyenne</div>
              </div>
              <div className="mt-auto pt-4">
                <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800/50 bg-slate-950/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-400"
                    style={{ width: `${stats?.disk_percent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-6">
            <div className="flex h-[280px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Historique CPU</div>
              <div className="relative flex-1">
                <canvas ref={cpuChartRef} />
              </div>
            </div>
            <div className="flex h-[280px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Historique RAM</div>
              <div className="relative flex-1">
                <canvas ref={ramChartRef} />
              </div>
            </div>
            <div className="flex h-[280px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Historique Disque</div>
              <div className="relative flex-1">
                <canvas ref={diskChartRef} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6 xl:gap-6">
            <div className="flex flex-col gap-1 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Thermometer className="h-4 w-4 text-rose-400" /> Température
              </div>
              <div className="mt-1">
                <div className="text-3xl font-bold tracking-tight text-white">
                  {stats?.temperature_summary.current !== null && stats?.temperature_summary.current !== undefined
                    ? `${stats.temperature_summary.current.toFixed(1)} °C`
                    : "N/A"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {stats?.temperature_summary.level === "critical"
                    ? "Température critique"
                    : stats?.temperature_summary.level === "warning"
                      ? "Température élevée"
                      : stats?.temperature_summary.level === "normal"
                        ? "Température normale"
                        : "Température indisponible"}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Wifi className="h-4 w-4 text-sky-400" /> Connexion
              </div>
              <div className="mt-1">
                <div className="text-3xl font-bold tracking-tight text-white">{stats?.connection_status ?? "..."}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {stats?.internet_access ? "Test HTTP sortant réussi" : "Aucun accès Internet détecté"}
                </div>
                <div className="mt-2 text-[10px] text-slate-600">{formatTimeAgo(stats?.last_internet_check ?? 0)}</div>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Clock className="h-4 w-4 text-emerald-400" /> Uptime
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight text-white">{stats ? formatUptime(stats.uptime) : "--"}</div>
                <div className="mt-1 text-sm text-slate-500">Temps depuis le démarrage</div>
              </div>
              <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-emerald-400/80">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Système actif
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Activity className="h-4 w-4 text-indigo-400" /> Débit réseau
              </div>
              <div className="mt-2 flex items-center gap-8">
                <div className="flex items-center gap-3">
                  <ArrowDownToLine className="h-6 w-6 text-emerald-400" />
                  <span className="text-2xl font-bold tracking-tight text-white">
                    {stats ? formatSpeed(stats.network_summary.download_bps) : "--"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <ArrowUpFromLine className="h-6 w-6 text-rose-400" />
                  <span className="text-2xl font-bold tracking-tight text-white">
                    {stats ? formatSpeed(stats.network_summary.upload_bps) : "--"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5 backdrop-blur-sm lg:col-span-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <HardDrive className="h-4 w-4 text-orange-400" /> I/O Disque
              </div>
              <div className="mt-2 flex items-center gap-10">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase text-slate-500">Lecture</span>
                  <span className="mt-1 text-2xl font-bold tracking-tight text-white">
                    {stats ? formatSpeed(stats.disk_io_summary.read_bytes) : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase text-slate-500">Écriture</span>
                  <span className="mt-1 text-2xl font-bold tracking-tight text-white">
                    {stats ? formatSpeed(stats.disk_io_summary.write_bytes) : "--"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-6">
            <div className="flex max-h-[300px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Cpu className="h-4 w-4 text-teal-400" /> Top processus CPU
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto pr-2">
                {topCpu.length === 0 ? (
                  <div className="text-sm text-slate-500">Aucun processus disponible.</div>
                ) : (
                  topCpu.map((proc) => (
                    <div className="mb-2 rounded-xl border border-slate-800/40 bg-slate-950/40 p-3" key={proc.pid}>
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-200">{proc.name}</strong>
                        <span className="font-mono text-sm text-teal-400">{proc.cpu_usage.toFixed(1)}%</span>
                      </div>
                      <div className="text-xs text-slate-500">PID: {proc.pid}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex max-h-[300px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <MemoryStick className="h-4 w-4 text-blue-400" /> Top processus RAM
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto pr-2">
                {topRam.length === 0 ? (
                  <div className="text-sm text-slate-500">Aucun processus disponible.</div>
                ) : (
                  topRam.map((proc) => (
                    <div className="mb-2 rounded-xl border border-slate-800/40 bg-slate-950/40 p-3" key={proc.pid}>
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-200">{proc.name}</strong>
                        <span className="font-mono text-sm text-blue-400">{formatBytes(proc.memory)}</span>
                      </div>
                      <div className="text-xs text-slate-500">PID: {proc.pid}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex max-h-[300px] flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <HardDrive className="h-4 w-4 text-orange-400" /> Top processus I/O
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto pr-2">
                {topIo.length === 0 ? (
                  <div className="text-sm text-slate-500">Aucune activité I/O détectée.</div>
                ) : (
                  topIo.map((proc) => (
                    <div className="mb-2 rounded-xl border border-slate-800/40 bg-slate-950/40 p-3" key={proc.pid}>
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-200">{proc.name}</strong>
                        <span className="font-mono text-sm text-orange-400">
                          {formatSpeed(proc.read_bytes + proc.write_bytes)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Lecture: {formatSpeed(proc.read_bytes)} · Écriture: {formatSpeed(proc.write_bytes)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-slate-800/60 pb-4">
              <Box className="h-5 w-5 text-sky-400" />
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">Docker</h2>
                <p className="text-xs text-slate-500">
                  {dockerContainers.length} conteneur(s),{" "}
                  {dockerContainers.filter((c) => c.status.toLowerCase().includes("running")).length} en cours d'exécution
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dockerContainers.length === 0 ? (
                <div className="text-sm text-slate-500">Docker indisponible ou aucun conteneur trouvé.</div>
              ) : (
                dockerContainers.map((container) => {
                  const st = normalizeContainerStatus(container.status);
                  return (
                    <div
                      key={container.name}
                      className="flex items-center justify-between rounded-xl border border-slate-800/40 bg-slate-950/50 p-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">{container.name}</div>
                        <div className="text-xs text-slate-500">
                          CPU: {formatPercent(container.cpu_percent)} · RAM: {formatPercent(container.mem_percent)}
                        </div>
                      </div>
                      <div
                        className={`rounded-full border px-2 py-1 text-xs font-medium ${
                          st.className === "running"
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            : st.className === "stopped"
                              ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
                              : "border-slate-700 bg-slate-800 text-slate-400"
                        }`}
                      >
                        {st.label}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-6">
            <div className="flex flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <HardDrive className="h-4 w-4 text-slate-400" /> Disques Logiques
              </div>
              <div className="flex-1 space-y-3 overflow-auto pr-2 max-h-56 md:max-h-80 lg:max-h-96">
                {stats?.disks?.length ? (
                  stats.disks.map((disk) => (
                    <div key={disk.name} className="rounded-lg border border-slate-800/40 bg-slate-950/40 p-3">
                      <div className="mb-1 flex justify-between">
                        <strong className="text-sm text-slate-200">{disk.name}</strong>
                        <span className="text-xs text-slate-400">
                          {formatBytes(disk.used_space)} / {formatBytes(disk.total_space)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-slate-400" style={{ width: `${disk.used_percent}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">Utilisé: {formatPercent(disk.used_percent)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">Aucun disque détecté.</div>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Network className="h-4 w-4 text-slate-400" /> Interfaces Réseau
              </div>
              <div className="flex-1 space-y-3 overflow-auto pr-2 max-h-56 md:max-h-80 lg:max-h-96">
                {stats?.networks?.length ? (
                  stats.networks.map((net) => (
                    <div
                      key={net.name}
                      className="flex items-center justify-between rounded-lg border border-slate-800/40 bg-slate-950/40 p-3"
                    >
                      <div>
                        <strong className="text-sm text-slate-200">{net.name}</strong>
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          Rx: {formatBytes(net.total_received)} · Tx: {formatBytes(net.total_transmitted)}
                        </div>
                      </div>
                      <span className="rounded border border-emerald-500/20 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-400">
                        Up
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">Aucune interface réseau détectée.</div>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-slate-800/60 bg-slate-900/50 p-5">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Fan className="h-4 w-4 text-slate-400" /> Capteurs & Températures
              </div>
              <div className="flex-1 space-y-3 overflow-auto pr-2 max-h-56 md:max-h-80 lg:max-h-96">
                {stats?.temperatures?.length ? (
                  stats.temperatures.map((temp) => (
                    <div
                      key={temp.label}
                      className="flex items-center justify-between rounded-lg border border-slate-800/40 bg-slate-950/40 p-3"
                    >
                      <strong className="text-sm text-slate-200">{temp.label || "Capteur"}</strong>
                      <span className="font-mono text-sm text-rose-400">
                        {temp.temperature !== null && temp.temperature !== undefined ? `${temp.temperature.toFixed(1)}°C` : "N/A"}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">Aucune température disponible.</div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-2 text-xs text-slate-500">
            <span>
              {error
                ? `Erreur: ${error}`
                    : stats && (stats.last_update || stats.last_internet_check) && (stats.last_update || stats.last_internet_check) > 0
                    ? `Dernière mise à jour : ${new Date((stats.last_update || stats.last_internet_check) * 1000).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}`
                : 'Données en direct...'}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Connecté
            </span>
          </div>
        </main>

        <footer className="pb-4 pt-8 text-center text-xs text-slate-600">
          © <span>{new Date().getFullYear()}</span> Server Monitor
        </footer>
      </div>
    </div>
  );
}
