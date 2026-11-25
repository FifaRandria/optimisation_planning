# Optimiseur de transport : commandes courantes (Linux / WSL, Docker Engine + Compose v2)
#   make help   → liste des commandes

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
DB_USER := transport_app
DB_NAME := transport_optimizer

# variables de .env (POSTGRES_PASSWORD, APP_PORT…) si le fichier existe
-include .env
APP_PORT ?= 3000
DEV_DB_PORT ?= 5433
ADMIN_USERNAME ?= admin

.PHONY: help init check-env build up down restart logs ps dev-db dev psql backup restore test clean map-init map-up map-hdx

# carte (page « Axes ») : extrait OpenStreetMap de Madagascar
MAP_PBF := madagascar-latest.osm.pbf
MAP_URL := https://download.geofabrik.de/africa/madagascar-latest.osm.pbf
OSRM_IMAGE := ghcr.io/project-osrm/osrm-backend:v5.27.1
# HDX (Humanitarian Data Exchange) : limites administratives COD-AB et lieux habités de Madagascar
HDX := https://data.humdata.org/dataset
HDX_COD_AB := $(HDX)/26fa506b-0727-4d9d-a590-d2abee21ee22/resource/4cefb60b-0986-4a91-8186-70ef5730ede6/download/mdg_admin_boundaries.geojson.zip
HDX_COD_AB_XLSX := $(HDX)/26fa506b-0727-4d9d-a590-d2abee21ee22/resource/44c25ef4-e858-48e3-8d93-f0d4d08bdc9c/download/mdg_admin_boundaries.xlsx
HDX_PLACES := $(HDX)/57202386-65f8-426f-8f51-be10c9f7c6ae/resource/09cc9db2-2aa7-4301-91b7-ae87f9f81c85/download/mdg_pplp_places_nga_ocha.zip

help: ## Affiche cette aide
	@echo "Optimiseur de transport : commandes disponibles"
	@echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36mmake %-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Premier lancement : make init && make up"

init: ## Crée .env à partir de .env.example (mot de passe de la base généré)
	@if [ -f .env ]; then echo ".env existe déjà : rien à faire."; exit 0; fi; \
	tr -d '\r' < .env.example > .env; \
	pw=$$(openssl rand -hex 24); \
	sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$pw/" .env; \
	echo ".env créé (mot de passe PostgreSQL généré). Vérifiez ADMIN_PASSWORD avant le premier démarrage."

check-env:
	@if [ ! -f .env ]; then echo "Fichier .env absent : lancez d'abord « make init »."; exit 1; fi
	@if grep -q '^POSTGRES_PASSWORD=A_GENERER' .env; then echo "POSTGRES_PASSWORD n'est pas défini dans .env (lancez « make init » ou renseignez-le)."; exit 1; fi

build: check-env ## Construit l'image de l'application
	$(COMPOSE) build app

up: check-env ## Construit et démarre l'application + la base, puis attend qu'elles soient prêtes
	$(COMPOSE) up -d --build --wait
	@echo
	@echo "Application prête : http://localhost:$(APP_PORT)"
	@echo "Première connexion : identifiant « $(ADMIN_USERNAME) » et ADMIN_PASSWORD de .env (à changer immédiatement)."

down: ## Arrête les conteneurs (les données sont conservées)
	$(COMPOSE) --profile dev --profile map down

restart: check-env ## Redémarre l'application (après une mise à jour du code : make up)
	$(COMPOSE) restart app

logs: ## Journaux en continu (make logs s=db pour la base)
	$(COMPOSE) logs -f --tail=200 $(or $(s),app)

ps: ## État des services
	$(COMPOSE) ps

dev-db: check-env ## Base seule, publiée sur 127.0.0.1:5433, pour développer avec « make dev »
	$(COMPOSE) stop app db
	$(COMPOSE) --profile dev up -d --wait db-dev
	@echo "Base de développement prête sur 127.0.0.1:$(DEV_DB_PORT). Lancez « make dev »."

dev: check-env ## Lance « next dev » sur le poste (rechargement à chaud) contre la base de make dev-db
	DATABASE_URL="postgres://$(DB_USER):$(POSTGRES_PASSWORD)@localhost:$(DEV_DB_PORT)/$(DB_NAME)" COOKIE_SECURE=false npm run dev

psql: ## Console SQL dans la base
	$(COMPOSE) exec db psql -U $(DB_USER) -d $(DB_NAME)

backup: ## Sauvegarde la base dans backups/AAAA-MM-JJ_HHMM.sql.gz
	@mkdir -p backups
	@f="backups/$$(date +%Y-%m-%d_%H%M).sql.gz"; \
	$(COMPOSE) exec -T db pg_dump -U $(DB_USER) -d $(DB_NAME) --clean --if-exists --no-owner | gzip > "$$f" && \
	echo "Sauvegarde : $$f ($$(du -h "$$f" | cut -f1))"

restore: ## Restaure une sauvegarde : make restore f=backups/xxx.sql.gz (remplace les données actuelles)
	@if [ -z "$(f)" ] || [ ! -f "$(f)" ]; then echo "Indiquez une sauvegarde existante : make restore f=backups/xxx.sql.gz"; exit 1; fi
	@read -p "Remplacer TOUTES les données actuelles par $(f) ? Tapez « oui » : " r; [ "$$r" = "oui" ] || { echo "Annulé."; exit 1; }
	$(COMPOSE) stop app
	gunzip -c "$(f)" | $(COMPOSE) exec -T db psql -q -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME)
	$(COMPOSE) start app
	@echo "Restauration terminée."

map-init: check-env ## Carte : télécharge Madagascar (OSM), prépare les itinéraires et importe le géocodage (une fois, 30-60 min)
	@mkdir -p map-data
	@if [ ! -f map-data/$(MAP_PBF) ]; then curl -fL -o map-data/$(MAP_PBF) $(MAP_URL); else echo "Extrait déjà présent : map-data/$(MAP_PBF)"; fi
	docker run --rm -v "$$PWD/map-data:/data" $(OSRM_IMAGE) osrm-extract -p /opt/car.lua /data/$(MAP_PBF)
	docker run --rm -v "$$PWD/map-data:/data" $(OSRM_IMAGE) osrm-partition /data/madagascar-latest.osrm
	docker run --rm -v "$$PWD/map-data:/data" $(OSRM_IMAGE) osrm-customize /data/madagascar-latest.osrm
	@grep -q '^OSRM_URL=' .env || echo 'OSRM_URL=http://osrm:5000' >> .env
	@grep -q '^NOMINATIM_URL=' .env || echo 'NOMINATIM_URL=http://nominatim:8080' >> .env
	$(COMPOSE) --profile map up -d osrm nominatim
	$(COMPOSE) up -d app
	@echo
	@echo "Itinéraires prêts. Le géocodage importe Madagascar (plusieurs dizaines de minutes au 1er démarrage) :"
	@echo "suivez « make logs s=nominatim » jusqu'à « Nominatim is ready »."

map-hdx: ## Carte : télécharge les fokontany / communes officiels (HDX, ~90 Mo) et régénère lib/geo/gazetteer-analamanga.json
	@mkdir -p map-data/hdx/cod-ab map-data/hdx/populated-places
	curl -fL -o map-data/hdx/cod-ab/mdg_admin_boundaries.geojson.zip "$(HDX_COD_AB)"
	curl -fL -o map-data/hdx/cod-ab/mdg_admin_boundaries.xlsx "$(HDX_COD_AB_XLSX)"
	curl -fL -o map-data/hdx/populated-places/mdg_pplp_places_nga_ocha.zip "$(HDX_PLACES)"
	cd map-data/hdx/cod-ab && unzip -oq mdg_admin_boundaries.geojson.zip -d geojson
	cd map-data/hdx/populated-places && unzip -oq mdg_pplp_places_nga_ocha.zip -d shp
	npx tsx scripts/build-gazetteer.ts

map-up: check-env ## Carte : démarre les services itinéraires + géocodage (après make map-init)
	$(COMPOSE) --profile map up -d osrm nominatim

test: ## Tests de l'algorithme (données de démo + exemple fictif ; Node.js requis sur le poste)
	npm run test:real
	npx tsx scripts/exemple-fictif.ts
	npx tsx scripts/test-axes-builder.ts
	npx tsx scripts/test-fichier-axes.ts

clean: ## Arrête tout et SUPPRIME les données (comptes, historique)
	@read -p "Supprimer définitivement la base (comptes, historique) ? Tapez « supprimer » : " r; [ "$$r" = "supprimer" ] || { echo "Annulé."; exit 1; }
	@read -p "Dernière confirmation : une sauvegarde a-t-elle été faite (make backup) ? [o/N] " r; [ "$$r" = "o" ] || { echo "Annulé."; exit 1; }
	$(COMPOSE) --profile dev down -v
