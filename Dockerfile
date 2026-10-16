# ---- build ----
FROM rust:1.90-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY db ./db
# sqlx vérifie les requêtes à la compile ; offline car requêtes non typées dynamiquement ici.
ENV SQLX_OFFLINE=true
RUN cargo build --release

# ---- front ----
FROM node:22-alpine AS webbuilder
WORKDIR /web
COPY web/package.json web/package-lock.json* web/npm-shrinkwrap.json* ./
RUN npm install --no-audit --no-fund
COPY web ./
RUN npm run build

# ---- run (non-root, port > 1024) ----
FROM debian:12-slim
RUN useradd -u 1000 -m appuser && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER 1000
WORKDIR /app
COPY --from=builder /build/target/release/lendrr-suivi /app/lendrr-suivi
COPY --from=builder /build/db /app/db
COPY --from=webbuilder /web/dist /app/web/dist
ARG GIT_SHA=dev
ENV PORT=8080 GIT_SHA=$GIT_SHA
EXPOSE 8080
CMD ["/app/lendrr-suivi"]
