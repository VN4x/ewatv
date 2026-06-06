.PHONY: help run build test tidy podman-up podman-down podman-dev migrate lint

help:
	@echo "Targets: run, build, podman-dev, podman-up, podman-down"

run:
	go run ./cmd/server -config configs/config.example.yaml

build:
	CGO_ENABLED=0 go build -o bin/ewatv-playout ./cmd/server

test:
	go test ./...

tidy:
	go mod tidy

# Production stack (requires podman secrets — see deployments/podman/scripts/create-secrets.sh)
podman-up:
	podman compose -f deployments/podman/compose.yaml up --build -d

podman-down:
	podman compose -f deployments/podman/compose.yaml down

# Local dev: Postgres + Redis, no secrets
podman-dev:
	podman compose -f deployments/podman/compose.dev.yaml up -d

migrate:
	chmod +x scripts/migrate.sh && ./scripts/migrate.sh

lint:
	go vet ./...
	go fmt ./...

secrets:
	chmod +x deployments/podman/scripts/create-secrets.sh
	./deployments/podman/scripts/create-secrets.sh
