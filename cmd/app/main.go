package main

import (
	"conformal-app/internal/handlers"
	"log"
	"net/http"
	"time"
)

func main() {
	mux := http.NewServeMux()

	fileServer := http.FileServer(http.Dir("./ui/static"))
	mux.Handle("/static/", http.StripPrefix("/static", fileServer))

	mux.HandleFunc("/", handlers.Home)
	mux.HandleFunc("/api/compute/single", handlers.ComputeSingleThread)
	mux.HandleFunc("/api/compute/parallel", handlers.ComputeParallel)
	mux.HandleFunc("/api/map-point", handlers.MapPoint)

	srv := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Println("Server starting at http://localhost:8080")
	log.Fatal(srv.ListenAndServe())
}
