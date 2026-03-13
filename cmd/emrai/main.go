package main

import (
	"log"

	"github.com/andybarilla/emrai/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	log.Printf("emrai starting on port %s", cfg.Port)
}
