# Convenience targets for local development.
# TODO: flesh out each target's commands.

.PHONY: up down test eval lint

up:
	docker compose up --build

down:
	docker compose down

test:
	cd backend && pytest

eval:
	cd backend && python -m evaluation.run_eval

lint:
	cd backend && ruff check .
	cd frontend && npm run lint
