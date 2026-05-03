use axum::{routing::get, Json, Router};
use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
struct Stats {
    total_memory: u64,
    used_memory: u64,
    total_swap: u64,
    used_swap: u64,
    cpu_count: usize,
    uptime: u64,
}

async fn get_stats() -> Json<Stats> {
    let mut sys = System::new_all();
    sys.refresh_all();

    Json(Stats {
        total_memory: sys.total_memory(),
        used_memory: sys.used_memory(),
        total_swap: sys.total_swap(),
        used_swap: sys.used_swap(),
        cpu_count: sys.cpus().len(),
        uptime: System::uptime(),
    })
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/stats", get(get_stats));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}