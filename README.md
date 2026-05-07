# Server Monitor

Server Monitor is a small system dashboard written in Rust that collects hardware and OS metrics (CPU, RAM, disk, network, temperatures, processes, simple Docker container info) and exposes them over a tiny HTTP API consumed by a React/Vite frontend.

<img width="1498" height="843" alt="image" src="https://github.com/user-attachments/assets/48940be5-bf0d-403b-84bc-6d77f8fca2df" />



[Test it out here !](https://stats.xenox.fr)

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
The repository includes a `docker-compose.yml` that builds both services from the local `backend/` and `frontend/` folders. The frontend nginx container exposes the dashboard on port `3011`.

```yaml
services:
  backend:
    build:
      context: ./backend
    image: server-monitor-backend:latest
    container_name: server-monitor-backend
    restart: no
    expose:
      - "3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /srv:/srv:ro
    pid: host
    uts: host
    privileged: true
    group_add:
      - "984"
    networks:
      - server-monitor-network

  frontend:
    build:
      context: ./frontend
    image: server-monitor-frontend:latest
    container_name: server-monitor-frontend
    restart: unless-stopped
    expose:
      - "80"
    ports:
      - "3011:80"
    depends_on:
      - backend
    networks:
      - server-monitor-network

networks:
  server-monitor-network:
    driver: bridge
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

## GitHub Actions deployment
The workflow in `.github/workflows/deploy.yml` deploys on every push to `main` using a self-hosted runner:

```bash
docker compose up --build -d
docker image prune -f
```

Install the self-hosted runner on the Raspberry Pi or on the target host that has Docker access. The runner user must be allowed to run Docker commands and read `/var/run/docker.sock`.

Notes and tips
- The frontend calls `/api/stats` with a relative URL. If you use an external nginx reverse proxy, route `/api/` to the backend service and route the rest to the frontend service.
- The backend uses `pid: host` so the process leaderboards include host processes, not only the monitor container itself.
- The backend uses `uts: host` so the API can expose the host machine name rather than a container hostname.
- The backend mounts `/srv` read-only so disks mounted there, including NAS volumes, are visible in the logical disks list.
- If you want the frontend to be served by the backend in production, you can build the frontend and copy the `dist/` output into `backend/static/` during CI or your Dockerfile build stages. That way the Rust server can serve the static files directly.
- The backend currently enables a permissive CORS layer to make local development with Vite easy. For production, restrict origins appropriately.
- When running the backend inside Docker and mounting `/var/run/docker.sock`, be aware this grants the container access to the host Docker daemon (security implications).

Troubleshooting
- If the frontend can't reach the backend in Docker Compose, ensure the frontend is configured to use the backend service name (for example `http://backend:3000`) or use a reverse-proxy.
- If the backend fails because it cannot connect to Docker, remove the `bollard`-related parts or run the container with the Docker socket mounted.

License & credits
- This project is a personal/home project.
