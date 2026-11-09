FROM rust:1.95-bookworm

RUN cargo install wasm-pack --version 0.15.1 --locked
RUN rustup target add wasm32-unknown-unknown

WORKDIR /build
COPY Cargo.toml ./Cargo.toml
COPY Cargo.lock ./Cargo.lock
COPY src ./src

CMD ["wasm-pack", "build", "--target", "web", "--release", "--out-dir", "/out"]
