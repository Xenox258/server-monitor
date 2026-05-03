use axum::{response::Html, routing::get, Json, Router};
use serde::Serialize;
use sysinfo::{Components, Disks, Networks, System};
use tower_http::services::ServeDir;

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
    disks: Vec<DiskStat>,
    networks: Vec<NetworkStat>,
    temperatures: Vec<TempStat>,
}

async fn get_stats() -> Json<Stats> {
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

    let networks_map = Networks::new_with_refreshed_list();

    let networks: Vec<NetworkStat> = networks_map
        .iter()
        .map(|(name, data)| NetworkStat {
            name: name.to_string(),
            total_received: data.total_received(),
            total_transmitted: data.total_transmitted(),
        })
        .collect();

    let internet_access = match reqwest::get("https://clients3.google.com/generate_204").await {
    Ok(response) => response.status().is_success(),
    Err(_) => false,
    };

    let connection_status = if internet_access {
        "Internet OK".to_string()
    } else {
        "Pas d'accès Internet".to_string()
    };

    let temperatures = Components::new_with_refreshed_list()
        .iter()
        .map(|component| TempStat {
            label: component.label().to_string(),
            temperature: component.temperature(),
        })
        .collect();

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
    let app = Router::new()
        .route("/", get(index))
        .route("/api/stats", get(get_stats))
        .nest_service("/static", ServeDir::new("src/static"));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}