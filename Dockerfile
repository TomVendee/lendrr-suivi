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

# ---- run (non-root, port > 1024) ----
FROM debian:12-slim
RUN useradd -u 1000 -m appuser && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER 1000
WORKDIR /app
COPY --from=builder /build/target/release/lendrr-suivi /app/lendrr-suivi
COPY --from=builder /build/db /app/db
COPY web /app/web
ENV PORT=8080
EXPOSE 8080
CMD ["/app/lendrr-suivi"]
