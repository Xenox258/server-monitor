let cpuChart;
let ramChart;
let diskChart;

function createLineChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: color + "33",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          display: false
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: "#94a3b8"
          },
          grid: {
            color: "#334155"
          }
        }
      }
    }
  });
}

function initCharts() {
  cpuChart = createLineChart("cpu_chart", "CPU", "#22c55e");
  ramChart = createLineChart("ram_chart", "RAM", "#f59e0b");
  diskChart = createLineChart("disk_chart", "Disque", "#ef4444");
}

function updateChart(chart, values) {
  chart.data.labels = values.map((_, i) => i + 1);
  chart.data.datasets[0].data = values;
  chart.update();
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return value.toFixed(2) + " " + units[index];
}

function formatPercent(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "0.0 %";
  return n.toFixed(1) + " %";
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(days + "j");
  if (hours > 0) parts.push(hours + "h");
  if (minutes > 0) parts.push(minutes + "m");
  parts.push(secs + "s");

  return parts.join(" ");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function renderDisks(disks) {
  const el = document.getElementById("disks");
  if (!disks.length) {
    el.innerHTML = '<div class="muted">Aucun disque détecté.</div>';
    return;
  }

  el.innerHTML = disks.map(disk => `
    <div class="list-row">
      <strong>${disk.name}</strong>
      <div>Libre: ${formatBytes(disk.available_space)} / ${formatBytes(disk.total_space)}</div>
      <div class="muted">Utilisé: ${formatBytes(disk.used_space)} (${disk.used_percent.toFixed(1)} %)</div>
    </div>
  `).join("");
}

function renderNetworks(networks) {
  const el = document.getElementById("networks");
  if (!networks.length) {
    el.innerHTML = '<div class="muted">Aucune interface réseau détectée.</div>';
    return;
  }

  el.innerHTML = networks.map(net => `
    <div class="list-row">
      <strong>${net.name}</strong>
      <div>Téléchargé: ${formatBytes(net.total_received)}</div>
      <div>Envoyé: ${formatBytes(net.total_transmitted)}</div>
    </div>
  `).join("");
}

function renderTemperatures(temperatures) {
  const el = document.getElementById("temperatures");
  if (!temperatures.length) {
    el.innerHTML = '<div class="muted">Aucune température disponible.</div>';
    return;
  }

  el.innerHTML = temperatures.map(temp => `
    <div class="list-row">
      <strong>${temp.label || "Capteur"}</strong>
      <div>${temp.temperature !== null ? temp.temperature.toFixed(1) + " °C" : "N/A"}</div>
    </div>
  `).join("");
}

function formatTimeAgo(unixSeconds) {
  if (!unixSeconds || unixSeconds <= 0) {
    return "Dernier test : jamais";
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSeconds - unixSeconds);

  if (diff < 60) {
    return `Dernier test : il y a ${diff} s`;
  }

  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `Dernier test : il y a ${minutes} min`;
  }

  const hours = Math.floor(diff / 3600);
  return `Dernier test : il y a ${hours} h`;
}

function formatSpeed(bytesPerSecond) {
  const n = Number(bytesPerSecond || 0);

  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
}

function renderIoProcesses(processes) {
  const el = document.getElementById("top_io_processes");

  if (!Array.isArray(processes) || processes.length === 0) {
    el.innerHTML = '<div class="muted">Aucune activité I/O détectée.</div>';
    return;
  }

  el.innerHTML = processes.map(proc => `
    <div class="list-row">
      <strong>${proc.name}</strong>
      <div>PID: ${proc.pid}</div>
      <div class="muted">
        Lecture: ${formatBytes(proc.read_bytes)} · Écriture: ${formatBytes(proc.write_bytes)}
      </div>
    </div>
  `).join("");
}

function renderProcesses(elementId, processes) {
  const el = document.getElementById(elementId);
  if (!processes || !processes.length) {
    el.innerHTML = '<div class="muted">Aucun processus disponible.</div>';
    return;
  }

  el.innerHTML = processes.map(proc => `
    <div class="list-row">
      <strong>${proc.name}</strong>
      <div>PID: ${proc.pid}</div>
      <div class="muted">CPU: ${proc.cpu_usage.toFixed(1)} % · RAM: ${formatBytes(proc.memory)}</div>
    </div>
  `).join("");
}

function formatContainerPercent(value) {
  const n = Number(value || 0);
  return `${n.toFixed(1)} %`;
}

function normalizeContainerStatus(status) {
  const value = (status || "").toLowerCase();

  if (value.includes("running")) {
    return { label: "Running", className: "running" };
  }

  if (value.includes("exited") || value.includes("stopped")) {
    return { label: "Stopped", className: "stopped" };
  }

  return { label: status || "Unknown", className: "other" };
}

function renderDockerContainers(containers) {
  const listEl = document.getElementById("docker_containers");
  const summaryEl = document.getElementById("docker_summary");

  if (!Array.isArray(containers) || containers.length === 0) {
    summaryEl.textContent = "Aucun conteneur détecté.";
    listEl.innerHTML = '<div class="muted">Docker indisponible ou aucun conteneur trouvé.</div>';
    return;
  }

  const runningCount = containers.filter(c =>
    (c.status || "").toLowerCase().includes("running")
  ).length;

  summaryEl.textContent = `${containers.length} conteneur(s), ${runningCount} en cours d'exécution`;

  listEl.innerHTML = containers.map(container => {
    const status = normalizeContainerStatus(container.status);

    return `
      <div class="docker-row">
        <div class="docker-name">${container.name}</div>
        <div class="docker-metric">CPU: ${formatContainerPercent(container.cpu_percent)}</div>
        <div class="docker-metric">RAM: ${formatContainerPercent(container.mem_percent)}</div>
        <div class="docker-metric">
          <span class="docker-status ${status.className}">${status.label}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) throw new Error("Réponse HTTP " + response.status);

    const stats = await response.json();

    document.getElementById("cpu_usage").textContent = formatPercent(stats.cpu_usage);
    document.getElementById("cpu_bar").style.width = `${Number(stats.cpu_usage) || 0}%`;

    document.getElementById("ram_percent").textContent = formatPercent(stats.memory_percent);
    document.getElementById("ram_detail").textContent =
      `${formatBytes(stats.used_memory)} / ${formatBytes(stats.total_memory)}`;
    document.getElementById("ram_bar").style.width = `${Number(stats.memory_percent) || 0}%`;

    document.getElementById("disk_percent").textContent = formatPercent(stats.disk_percent);
    document.getElementById("disk_bar").style.width = `${Number(stats.disk_percent) || 0}%`;

    document.getElementById("connection_status").textContent = stats.connection_status;
    document.getElementById("connection_detail").textContent =
    stats.internet_access ? "Test HTTP sortant réussi" : "Aucun accès Internet détecté";
    document.getElementById("internet_last_check").textContent =
    formatTimeAgo(stats.last_internet_check);
    document.getElementById("uptime").textContent = formatUptime(stats.uptime);
    updateChart(cpuChart, stats.history.cpu || []);
    updateChart(ramChart, stats.history.ram || []);
    updateChart(diskChart, stats.history.disk || []);
    document.getElementById("temperature_value").textContent =
  stats.temperature_summary.current !== null
    ? `${stats.temperature_summary.current.toFixed(1)} °C`
    : "N/A";

document.getElementById("temperature_detail").textContent =
  stats.temperature_summary.level === "critical"
    ? "Température critique"
    : stats.temperature_summary.level === "warning"
    ? "Température élevée"
    : stats.temperature_summary.level === "normal"
    ? "Température normale"
    : "Température indisponible";

document.getElementById("network_down").textContent =
  `↓ ${formatSpeed(stats.network_summary.download_bps)}`;
document.getElementById("network_up").textContent =
  `↑ ${formatSpeed(stats.network_summary.upload_bps)}`;
document.getElementById("disk_read_speed").textContent =
  `↓ ${formatBytes(stats.disk_io_summary.read_bytes)}`;

document.getElementById("disk_write_speed").textContent =
  `↑ ${formatBytes(stats.disk_io_summary.write_bytes)}`;

renderIoProcesses(stats.top_processes_io || []);

renderProcesses("top_cpu_processes", stats.top_processes_cpu);
renderProcesses("top_ram_processes", stats.top_processes_memory);

    renderDisks(safeArray(stats.disks));
    renderNetworks(safeArray(stats.networks));
    renderTemperatures(safeArray(stats.temperatures));
    renderDockerContainers(stats.docker_containers || []);

    const status = document.getElementById("status");
    status.textContent = "Dernière mise à jour : " + new Date().toLocaleTimeString();
    status.classList.remove("error");
  } catch (error) {
    const status = document.getElementById("status");
    status.textContent = "Erreur de chargement : " + error.message;
    status.classList.add("error");
  }
}



initCharts();
loadStats();
setInterval(loadStats, 2000);