// Simple system monitor HTTP server using axum.
//
// The server collects system metrics via `sysinfo`, optionally inspects
// Docker containers via `bollard`, and exposes a single JSON endpoint
// (`/api/stats`) for frontend consumption. Background tasks periodically
// check Internet connectivity and (optionally) refresh Docker container
// metadata. Shared application state is stored in an `AppState` and
// synchronized with async RwLocks.
use axum::{extract::State, routing::get, Json, Router};
use bollard::query_parameters::ListContainersOptions;
use bollard::Docker;
use reqwest::Client;
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Components, Disks, Networks, System};
use tokio::sync::RwLock;
use tokio::time::interval;
use tower_http::cors::{Any, CorsLayer};

const HISTORY_LEN: usize = 60;

// Summary information for a Docker container used by the frontend.
#[derive(Clone, Serialize)]
struct ContainerStat {
    name: String,
    status: String,
    cpu_percent: f32,
    mem_percent: f32,
}

// Global application state shared between request handlers and background
// tasks. Most fields are wrapped in `Arc<RwLock<...>>` to allow concurrent
// async reads and writes without blocking the runtime.
#[derive(Clone)]
struct AppState {
    internet_access: Arc<RwLock<bool>>,
    last_internet_check: Arc<RwLock<u64>>,
    cpu_history: Arc<RwLock<Vec<f64>>>,
    ram_history: Arc<RwLock<Vec<f64>>>,
    disk_history: Arc<RwLock<Vec<f64>>>,
    networks: Arc<RwLock<Networks>>,
    docker: Docker,
    docker_containers: Arc<RwLock<Vec<ContainerStat>>>,
}

// Time series history payload sent to the frontend. Each vector contains up
// to `HISTORY_LEN` samples collected over time.
#[derive(Serialize)]
struct History {
    cpu: Vec<f64>,
    ram: Vec<f64>,
    disk: Vec<f64>,
}

// Per-disk summary exposed to the frontend.
#[derive(Serialize)]
struct DiskStat {
    name: String,
    total_space: u64,
    available_space: u64,
    used_space: u64,
    used_percent: f64,
}

// Per-network interface counters.
#[derive(Serialize)]
struct NetworkStat {
    name: String,
    total_received: u64,
    total_transmitted: u64,
}

// Temperature reading for a sensor/component (may be None if not available).
#[derive(Serialize)]
struct TempStat {
    label: String,
    temperature: Option<f32>,
}

// Aggregated network summary values (rough instantaneous bytes per second).
#[derive(Serialize)]
struct NetworkSummary {
    download_bps: u64,
    upload_bps: u64,
}

// Lightweight process summary for CPU/memory leaderboards.
#[derive(Serialize, Clone)]
struct ProcessStat {
    pid: String,
    name: String,
    cpu_usage: f32,
    memory: u64,
}

// Single value summary derived from available temperature sensors.
#[derive(Serialize)]
struct TemperatureSummary {
    current: Option<f32>,
    level: String,
}

// Aggregated disk I/O counters for read/write bytes.
#[derive(Serialize)]
struct DiskIoSummary {
    read_bytes: u64,
    write_bytes: u64,
}

// Per-process I/O activity used to show top I/O consumers.
#[derive(Serialize, Clone)]
struct ProcessIoStat {
    pid: String,
    name: String,
    read_bytes: u64,
    write_bytes: u64,
}

// Full payload returned by the `/api/stats` endpoint. This struct captures
// the snapshot of system state at the time of the request and is serialized
// to JSON for the frontend.
#[derive(Serialize)]
struct Stats {
    total_memory: u64,
    used_memory: u64,
    memory_percent: f64,
    total_swap: u64,
    used_swap: u64,
    cpu_count: usize,
    cpu_usage: f32,
    uptime: u64,
    disk_percent: f64,
    connection_status: String,
    internet_access: bool,
    last_internet_check: u64,
    last_update: u64,
    disks: Vec<DiskStat>,
    networks: Vec<NetworkStat>,
    temperatures: Vec<TempStat>,
    history: History,
    temperature_summary: TemperatureSummary,
    network_summary: NetworkSummary,
    top_processes_cpu: Vec<ProcessStat>,
    top_processes_memory: Vec<ProcessStat>,
    docker_containers: Vec<ContainerStat>,
    disk_io_summary: DiskIoSummary,
    top_processes_io: Vec<ProcessIoStat>,
}

// Perform a lightweight HTTP request to a well-known endpoint that returns
// HTTP 204 when reachable. This provides a cheap check for outbound Internet
// connectivity. The function returns true on success, false otherwise.
async fn check_internet(client: &Client) -> bool {
    match client
        .get("https://clients3.google.com/generate_204")
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

// Safe percent calculation for u64 values. Returns 0.0 when total is zero
// to avoid division by zero.
fn percent_u64(used: u64, total: u64) -> f64 {
    if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    }
}

// Append a value to a fixed-length circular history buffer. When the buffer
// exceeds HISTORY_LEN the oldest element is removed.
fn push_history(history: &mut Vec<f64>, value: f64) {
    history.push(value);
    if history.len() > HISTORY_LEN {
        history.remove(0);
    }
}

// Background task that periodically queries the Docker daemon for a list
// of containers. The task updates `state.docker_containers` with a simple
// summary. For now CPU/memory percentages are placeholders (0.0) — this
// can be extended to query more detailed stats if needed.
async fn docker_monitor_task(state: AppState) {
    let mut ticker = interval(Duration::from_secs(10));

    loop {
        ticker.tick().await;

        let mut stats_list = Vec::new();

        let result = state
            .docker
            .list_containers(Some(ListContainersOptions {
                all: true,
                ..Default::default()
            }))
            .await;

        if let Ok(containers) = result {
            for c in containers {
                let name = c
                    .names
                    .as_ref()
                    .and_then(|names| names.first())
                    .map(|n| n.trim_start_matches('/').to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                let status = c
                    .state
                    .as_ref()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                stats_list.push(ContainerStat {
                    name,
                    status,
                    cpu_percent: 0.0,
                    mem_percent: 0.0,
                });
            }
        }

        *state.docker_containers.write().await = stats_list;
    }
}

// Background task that periodically checks outbound Internet connectivity
// with a small timeout to avoid blocking. It updates both the boolean
// `internet_access` flag and `last_internet_check` timestamp in shared state.
async fn internet_monitor_task(state: AppState) {
    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .connect_timeout(Duration::from_secs(1))
        .build()
        .unwrap();

    let mut ticker = interval(Duration::from_secs(30));

    loop {
        ticker.tick().await;

        let is_online = check_internet(&client).await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        {
            let mut internet_access = state.internet_access.write().await;
            *internet_access = is_online;
        }

        {
            let mut last_check = state.last_internet_check.write().await;
            *last_check = now;
        }
    }
}

// Handler that builds a snapshot of system metrics and returns them as JSON.
// This function gathers memory/cpu/disk statistics, process leaderboards,
// per-disk and network counters, temperature summaries, and an I/O summary.
// The function also updates the in-memory histories used by the frontend
// graphs.
async fn get_stats(State(state): State<AppState>) -> Json<Stats> {
    use std::cmp::Ordering;

    let mut sys = System::new_all();
    sys.refresh_all();
    sys.refresh_cpu_usage();

    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let memory_percent = percent_u64(used_memory, total_memory);

    let disks: Vec<DiskStat> = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|disk| {
            let total_space = disk.total_space();
            let available_space = disk.available_space();
            let used_space = total_space.saturating_sub(available_space);
            let used_percent = percent_u64(used_space, total_space);

            DiskStat {
                name: disk.name().to_string_lossy().to_string(),
                total_space,
                available_space,
                used_space,
                used_percent,
            }
        })
        .collect();

    let total_disk_space: u64 = disks.iter().map(|d| d.total_space).sum();
    let total_used_disk_space: u64 = disks.iter().map(|d| d.used_space).sum();

    let disk_percent = percent_u64(total_used_disk_space, total_disk_space);

    let cpu_usage = sys.global_cpu_usage() as f64;

    // update rolling histories used by the frontend charts
    {
        let mut cpu_history = state.cpu_history.write().await;
        push_history(&mut cpu_history, cpu_usage);
    }

    {
        let mut ram_history = state.ram_history.write().await;
        push_history(&mut ram_history, memory_percent);
    }

    {
        let mut disk_history = state.disk_history.write().await;
        push_history(&mut disk_history, disk_percent);
    }

    let history = History {
        cpu: state.cpu_history.read().await.clone(),
        ram: state.ram_history.read().await.clone(),
        disk: state.disk_history.read().await.clone(),
    };

    // collect network counters and compute a simple per-interval throughput
    let (networks, network_summary) = {
        let mut networks_guard = state.networks.write().await;
        networks_guard.refresh(true);

        let mut total_download_since_refresh = 0u64;
        let mut total_upload_since_refresh = 0u64;

        let networks: Vec<NetworkStat> = networks_guard
            .iter()
            .map(|(name, data)| {
                total_download_since_refresh += data.received();
                total_upload_since_refresh += data.transmitted();

                NetworkStat {
                    name: name.to_string(),
                    total_received: data.total_received(),
                    total_transmitted: data.total_transmitted(),
                }
            })
            .collect();

        let network_summary = NetworkSummary {
            // divide by 2 because frontend polls every ~2s; this is a
            // lightweight approximation for bytes-per-second
            download_bps: total_download_since_refresh / 2,
            upload_bps: total_upload_since_refresh / 2,
        };

        (networks, network_summary)
    };

    // read temperature components and compute a simple summary
    let temperatures: Vec<TempStat> = Components::new_with_refreshed_list()
        .iter()
        .map(|component| {
            let raw = component.temperature();
            // component.temperature() returns Option<f32>; filter out NaN values
            let temperature = raw.filter(|v| !v.is_nan());

            TempStat {
                label: component.label().to_string(),
                temperature,
            }
        })
        .collect();

    let max_temp = temperatures
        .iter()
        .filter_map(|t| t.temperature)
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

    let temperature_summary = TemperatureSummary {
        current: max_temp,
        level: match max_temp {
            Some(t) if t >= 80.0 => "critical".to_string(),
            Some(t) if t >= 70.0 => "warning".to_string(),
            Some(_) => "normal".to_string(),
            None => "unknown".to_string(),
        },
    };

    // build process lists and leaderboards
    let _process_count = sys.processes().len();
    let cpu_core_count = sys.cpus().len().max(1) as f32;

    let processes: Vec<ProcessStat> = sys
        .processes()
        .iter()
        .map(|(pid, process)| ProcessStat {
            pid: pid.to_string(),
            name: process.name().to_string_lossy().to_string(),
            cpu_usage: process.cpu_usage() / cpu_core_count,
            memory: process.memory(),
        })
        .collect();

    let mut top_processes_cpu = processes.clone();
    top_processes_cpu.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(Ordering::Equal)
    });
    top_processes_cpu.truncate(5);

    let mut top_processes_memory = processes;
    top_processes_memory.sort_by(|a, b| b.memory.cmp(&a.memory));
    top_processes_memory.truncate(5);

    let internet_access = *state.internet_access.read().await;
    let last_internet_check = *state.last_internet_check.read().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let connection_status = if internet_access {
        "Internet OK".to_string()
    } else {
        "Pas d'accès Internet".to_string()
    };
    let docker_containers = state.docker_containers.read().await.clone();

    // compute per-process I/O and an aggregated I/O summary
    let mut total_read_bytes = 0u64;
    let mut total_write_bytes = 0u64;

    let mut top_processes_io: Vec<ProcessIoStat> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            let usage = process.disk_usage();
            total_read_bytes += usage.read_bytes;
            total_write_bytes += usage.written_bytes;

            ProcessIoStat {
                pid: pid.to_string(),
                name: process.name().to_string_lossy().to_string(),
                // divide by 2 to approximate per-second values based on the
                // frontend polling interval (2s)
                read_bytes: usage.read_bytes / 2,
                write_bytes: usage.written_bytes / 2,
            }
        })
        .collect();

    top_processes_io.sort_by(|a, b| {
        let a_total = a.read_bytes + a.write_bytes;
        let b_total = b.read_bytes + b.write_bytes;
        b_total.cmp(&a_total)
    });
    top_processes_io.truncate(5);

    let disk_io_summary = DiskIoSummary {
        read_bytes: total_read_bytes / 2,
        write_bytes: total_write_bytes / 2,
    };
    Json(Stats {
        total_memory,
        used_memory,
        memory_percent,
        total_swap: sys.total_swap(),
        used_swap: sys.used_swap(),
        cpu_count: sys.cpus().len(),
        cpu_usage: cpu_usage as f32,
        uptime: System::uptime(),
        disk_percent,
        connection_status,
    internet_access,
    last_internet_check,
    last_update: now,
        disks,
        networks,
        temperatures,
        history,
        temperature_summary,
        network_summary,
        top_processes_cpu,
        top_processes_memory,
        docker_containers,
        disk_io_summary,
        top_processes_io,
    })
}

#[tokio::main]
async fn main() {
    let docker = Docker::connect_with_local_defaults().expect("Docker socket non trouvé");
    let state = AppState {
        internet_access: Arc::new(RwLock::new(false)),
        last_internet_check: Arc::new(RwLock::new(0)),
        cpu_history: Arc::new(RwLock::new(Vec::new())),
        ram_history: Arc::new(RwLock::new(Vec::new())),
        disk_history: Arc::new(RwLock::new(Vec::new())),
        networks: Arc::new(RwLock::new(Networks::new_with_refreshed_list())),
        docker,
        docker_containers: Arc::new(RwLock::new(Vec::new())),
    };

    tokio::spawn(internet_monitor_task(state.clone()));
    tokio::spawn(docker_monitor_task(state.clone()));

    let app = Router::new()
        .route("/api/stats", get(get_stats))
        .with_state(state)
        // Add a permissive CORS layer for local development (Vite dev server)
        .layer(
            CorsLayer::new()
                .allow_methods(Any)
                .allow_headers(Any)
                .allow_origin(Any),
        );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}