.PHONY: help run build test tidy docker-up docker-down migrate lint

help:
	@echo "Targets: run, build, test, tidy, docker-up, docker-down"

run:
	go run ./cmd/server -config configs/config.example.yaml

build:
	CGO_ENABLED=0 go build -o bin/ewatv-playout ./cmd/server

test:
	go test ./...

tidy:
	go mod tidy

docker-up:
	docker compose -f deployments/docker/docker-compose.yml up --build -d

docker-down:
	docker compose -f deployments/docker/docker-compose.yml down

migrate:
	psql "$${EWATV_DATABASE_URL:-postgres://ewatv:ewatv@localhost:5433/ewatv_playout?sslmode=disable}" \
		-f migrations/001_foundation.up.sql

lint:
	go vet ./...
	go fmt ./...
