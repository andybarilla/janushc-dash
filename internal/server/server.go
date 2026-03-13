package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/config"
)

type Server struct {
	cfg    *config.Config
	db     *pgxpool.Pool
	router *http.ServeMux
}

func New(cfg *config.Config, db *pgxpool.Pool) *Server {
	s := &Server{
		cfg:    cfg,
		db:     db,
		router: http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.router.HandleFunc("GET /api/health", s.handleHealth)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

func (s *Server) Start() error {
	addr := ":" + s.cfg.Port
	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, s.router)
}
