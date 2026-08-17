# Convenience targets for local development.
#
# `test` and `eval` run against DATABASE_URL, and the test fixtures
# TRUNCATE documents/chunks -- point it at a throwaway database, never
# your dev one.

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
