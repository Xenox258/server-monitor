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

    document.getElementById("uptime").textContent = formatUptime(stats.uptime);

    renderDisks(safeArray(stats.disks));
    renderNetworks(safeArray(stats.networks));
    renderTemperatures(safeArray(stats.temperatures));

    const status = document.getElementById("status");
    status.textContent = "Dernière mise à jour : " + new Date().toLocaleTimeString();
    status.classList.remove("error");
  } catch (error) {
    const status = document.getElementById("status");
    status.textContent = "Erreur de chargement : " + error.message;
    status.classList.add("error");
  }
}

loadStats();
setInterval(loadStats, 2000);