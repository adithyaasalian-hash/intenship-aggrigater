.PHONY: up down logs ingest seed test health clean

up:            ## Start everything (first run builds; takes a few minutes)
	docker compose up --build

down:
	docker compose down

clean:         ## Also wipe the database
	docker compose down -v

logs:
	docker compose logs -f api ml

ingest:        ## Pull from every enabled source right now
	docker compose exec api npm run ingest

seed:          ## Load only the committed seed listings
	docker compose exec api npm run ingest:seed

test:          ## Run the ML unit tests
	docker compose exec ml python tests/test_core.py

health:
	@curl -s localhost:4000/api/health | head -c 400; echo
	@curl -s localhost:8000/health | head -c 400; echo
