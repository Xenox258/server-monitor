use axum::{extract::State, response::Html, routing::get, Json, Router};
use reqwest::Client;
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Components, Disks, Networks, System};
use tokio::sync::RwLock;
use tokio::time::interval;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct AppState {
    internet_access: Arc<RwLock<bool>>,
    last_internet_check: Arc<RwLock<u64>>,
}

#[derive(Serialize)]
struct DiskStat {
    name: String,
    total_space: u64,
    available_space: u64,
    used_space: u64,
    used_percent: f64,
}

#[derive(Serialize)]
struct NetworkStat {
    name: String,
    total_received: u64,
    total_transmitted: u64,
}

#[derive(Serialize)]
struct TempStat {
    label: String,
    temperature: Option<f32>,
}

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
    disks: Vec<DiskStat>,
    networks: Vec<NetworkStat>,
    temperatures: Vec<TempStat>,
}

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

async fn get_stats(State(state): State<AppState>) -> Json<Stats> {
    let mut sys = System::new_all();
    sys.refresh_all();
    sys.refresh_cpu_usage();

    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let memory_percent = if total_memory > 0 {
        (used_memory as f64 / total_memory as f64) * 100.0
    } else {
        0.0
    };

    let disks: Vec<DiskStat> = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|disk| {
            let total_space = disk.total_space();
            let available_space = disk.available_space();
            let used_space = total_space.saturating_sub(available_space);
            let used_percent = if total_space > 0 {
                (used_space as f64 / total_space as f64) * 100.0
            } else {
                0.0
            };

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

    let disk_percent = if total_disk_space > 0 {
        (total_used_disk_space as f64 / total_disk_space as f64) * 100.0
    } else {
        0.0
    };

    let networks = Networks::new_with_refreshed_list()
        .iter()
        .map(|(name, data)| NetworkStat {
            name: name.to_string(),
            total_received: data.total_received(),
            total_transmitted: data.total_transmitted(),
        })
        .collect();

    let temperatures = Components::new_with_refreshed_list()
        .iter()
        .map(|component| TempStat {
            label: component.label().to_string(),
            temperature: component.temperature(),
        })
        .collect();

    let internet_access = *state.internet_access.read().await;
    let last_internet_check = *state.last_internet_check.read().await;

    let connection_status = if internet_access {
        "Internet OK".to_string()
    } else {
        "Pas d'accès Internet".to_string()
    };

    Json(Stats {
        total_memory,
        used_memory,
        memory_percent,
        total_swap: sys.total_swap(),
        used_swap: sys.used_swap(),
        cpu_count: sys.cpus().len(),
        cpu_usage: sys.global_cpu_usage(),
        uptime: System::uptime(),
        disk_percent,
        connection_status,
        internet_access,
        last_internet_check,
        disks,
        networks,
        temperatures,
    })
}

async fn index() -> Html<&'static str> {
    Html(include_str!("static/index.html"))
}

#[tokio::main]
async fn main() {
    let state = AppState {
        internet_access: Arc::new(RwLock::new(false)),
        last_internet_check: Arc::new(RwLock::new(0)),
    };

    tokio::spawn(internet_monitor_task(state.clone()));

    let app = Router::new()
        .route("/", get(index))
        .route("/api/stats", get(get_stats))
        .nest_service("/static", ServeDir::new("src/static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}