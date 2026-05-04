# Server Monitor

Server Monitor is a small system dashboard written in Rust that collects hardware and OS metrics (CPU, RAM, disk, network, temperatures, processes, simple Docker container info) and exposes them over a tiny HTTP API consumed by a React/Vite frontend.

[Test it out here !](stats.xenox.fr)

This repository contains two main pieces:
- `backend/` — Rust + axum server which gathers metrics (via `sysinfo`) and exposes `/api/stats`.
- `frontend/` — Vite + React application that renders the dashboard and charts.

This README explains how to build Docker images for the frontend and backend, and how to run the stack with Docker Compose.

## Prerequisites
- Docker (Engine) installed
- docker-compose (v2 or the Docker CLI `compose` plugin)
- Optional: if you want the backend to inspect local Docker containers, the container must have access to the host Docker socket (`/var/run/docker.sock`).

## Build Docker images
If you want to build the images manually, from the repository root run:

Build the backend image:

```bash
# from repo root
docker build -f backend/Dockerfile -t server-monitor-backend:latest ./backend
```

Build the frontend image (if a Dockerfile exists in `frontend/`):

```bash
# from repo root
docker build -f frontend/Dockerfile -t server-monitor-frontend:latest ./frontend
```

Notes:
- The backend image should expose port `3000` by default (the Rust server listens on 0.0.0.0:3000).
- The frontend dev server (Vite) usually runs on `5173` in dev mode; for production the frontend image should serve built static files.

## Run locally with docker run (quick)
Run the backend container and publish port 3000:

```bash
# simple run without Docker socket access
docker run -it --rm -p 3000:3000 server-monitor-backend:latest
```

If you want the backend to read information from the host Docker daemon (docker container list / stats), mount the Docker socket into the container:

```bash
docker run -it --rm -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock server-monitor-backend:latest
```

Run the frontend container (if built as a separate image) mapping the dev port or serving files:

```bash
docker run -it --rm -p 5173:5173 server-monitor-frontend:latest
```

## Docker Compose (recommended)
Below is a minimal `docker-compose.yml` example you can place at the repository root. It builds both services from the local `backend/` and `frontend/` folders and exposes ports for development.

```yaml
version: "3.8"
services:
  backend:
    build: ./backend
    image: server-monitor-backend:latest
    ports:
      - "3000:3000"
    volumes:
      # optional: allow backend to inspect host docker if you want docker monitoring
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped

  frontend:
    build: ./frontend
    image: server-monitor-frontend:latest
    ports:
      - "5173:5173"
    environment:
      # If your frontend needs to contact a different API URL, set it here
      # API_URL: http://backend:3000
    depends_on:
      - backend
    restart: unless-stopped
```

Start the stack:

```bash
# build images and start containers
docker compose up --build -d

# view logs
docker compose logs -f

# stop
docker compose down
```

Notes and tips
- If you want the frontend to be served by the backend in production, you can build the frontend and copy the `dist/` output into `backend/static/` during CI or your Dockerfile build stages. That way the Rust server can serve the static files directly.
- The backend currently enables a permissive CORS layer to make local development with Vite easy. For production, restrict origins appropriately.
- When running the backend inside Docker and mounting `/var/run/docker.sock`, be aware this grants the container access to the host Docker daemon (security implications).

Troubleshooting
- If the frontend can't reach the backend in Docker Compose, ensure the frontend is configured to use the backend service name (for example `http://backend:3000`) or use a reverse-proxy.
- If the backend fails because it cannot connect to Docker, remove the `bollard`-related parts or run the container with the Docker socket mounted.

License & credits
- This project is a personal/home project.
