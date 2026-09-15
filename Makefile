.PHONY: install dev test lint demo swarm gifs

install:
	pip install -e ".[vision]"

dev:
	pip install -e ".[dev,vision,data]"

test:
	pytest -q

lint:
	ruff check .

demo:
	flydrones demo --live

swarm:
	flydrones swarm --live

gifs:
	flydrones demo --seconds 21 --record assets/demo.gif --every 3
	flydrones swarm --seconds 20 --record assets/swarm.gif --every 3
