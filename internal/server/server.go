package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/janushc-dash/internal/approval"
	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/scribe"
)

type Server struct {
	cfg             *config.Config
	db              *pgxpool.Pool
	router          chi.Router
	queries         *database.Queries
	authHandler     *auth.Handler
	approvalHandler *approval.Handler
	scribeHandler   *scribe.Handler
}

func New(cfg *config.Config, db *pgxpool.Pool, queries *database.Queries, authHandler *auth.Handler, approvalHandler *approval.Handler, scribeHandler *scribe.Handler) *Server {
	s := &Server{
		cfg:             cfg,
		db:              db,
		router:          chi.NewRouter(),
		queries:         queries,
		authHandler:     authHandler,
		approvalHandler: approvalHandler,
		scribeHandler:   scribeHandler,
	}
	s.setupMiddleware()
	s.routes()
	return s
}

func (s *Server) setupMiddleware() {
	s.router.Use(middleware.RequestID)
	s.router.Use(middleware.Logger)
	s.router.Use(middleware.Recoverer)
	s.router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{s.cfg.CORSOrigin},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
}

func (s *Server) routes() {
	s.router.Get("/api/health", s.handleHealth)

	// Public routes
	s.router.Post("/api/auth/google", s.authHandler.HandleGoogleLogin)

	// Protected routes
	s.router.Group(func(r chi.Router) {
		r.Use(auth.Middleware(s.cfg.JWTSecret))

		r.Get("/api/auth/me", s.authHandler.HandleMe)
		r.Get("/api/approvals", s.approvalHandler.HandleListPending)
		r.Post("/api/approvals/batch-approve", s.approvalHandler.HandleBatchApprove)
		r.Post("/api/approvals/sync", s.approvalHandler.HandleSync)

		r.Post("/api/scribe/sessions", s.scribeHandler.HandleCreate)
		r.Get("/api/scribe/sessions", s.scribeHandler.HandleList)
		r.Get("/api/scribe/sessions/{id}", s.scribeHandler.HandleGet)
		r.Post("/api/scribe/sessions/{id}/process", s.scribeHandler.HandleProcess)
		r.With(middleware.Timeout(5 * time.Minute)).Post("/api/scribe/sessions/{id}/upload", s.scribeHandler.HandleUpload)
	})

	// SPA static file serving
	s.router.NotFound(s.spaHandler("frontend/dist"))
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

func (s *Server) spaHandler(distDir string) http.HandlerFunc {
	fs := http.FileServer(http.Dir(distDir))
	return func(w http.ResponseWriter, r *http.Request) {
		// Only serve GET/HEAD for static files
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		path := filepath.Clean(r.URL.Path)
		if strings.HasPrefix(path, "/api/") {
			http.NotFound(w, r)
			return
		}

		// Check if the file exists on disk; if not, serve index.html for SPA routing
		fullPath := filepath.Join(distDir, path)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
			return
		}

		fs.ServeHTTP(w, r)
	}
}

func (s *Server) Router() chi.Router {
	return s.router
}

func (s *Server) Start() error {
	addr := ":" + s.cfg.Port
	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, s.router)
}
