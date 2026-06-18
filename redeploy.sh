#!/bin/sh
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml up -d

