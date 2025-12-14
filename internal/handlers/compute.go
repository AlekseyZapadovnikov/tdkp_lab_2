package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type complexNumber struct {
	Re float64 `json:"re"`
	Im float64 `json:"im"`
}

type point struct {
	Z     complexNumber `json:"z"`
	W     complexNumber `json:"w"`
	Color string        `json:"color"`
}

type computeRequest struct {
	Count int `json:"count"`
}

type computeResponse struct {
	Mode       string  `json:"mode"`
	DurationMs int64   `json:"durationMs"`
	Points     []point `json:"points"`
	Count      int     `json:"count"`
	Requested  int     `json:"requested"`
}

type mapResponse struct {
	W complexNumber `json:"w"`
}

// extra CPU cycles per point to make parallel vs single-thread performance observable
const extraWorkIterations = 250

func ComputeSingleThread(w http.ResponseWriter, r *http.Request) {
	processCompute(w, r, false)
}

func ComputeParallel(w http.ResponseWriter, r *http.Request) {
	processCompute(w, r, true)
}

func MapPoint(w http.ResponseWriter, r *http.Request) {
	re, err := strconv.ParseFloat(r.URL.Query().Get("re"), 64)
	if err != nil {
		http.Error(w, "invalid real part", http.StatusBadRequest)
		return
	}
	im, err := strconv.ParseFloat(r.URL.Query().Get("im"), 64)
	if err != nil {
		http.Error(w, "invalid imaginary part", http.StatusBadRequest)
		return
	}

	z := complexNumber{Re: re, Im: im}
	log.Printf("map-point request re=%f im=%f", re, im)
	wVal, ok := mapZtoW(z)
	if !ok {
		http.Error(w, "mapping undefined for this point", http.StatusUnprocessableEntity)
		return
	}

	writeJSON(w, mapResponse{W: wVal})
}

func processCompute(w http.ResponseWriter, r *http.Request, parallel bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req computeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	requested := req.Count
	count := normalizeCount(requested)
	log.Printf("compute request mode=%s requested=%d normalized=%d", modeName(parallel), requested, count)

	start := time.Now()
	var points []point
	if parallel {
		points = generateAndMapParallel(count)
	} else {
		points = generateAndMapSequential(count)
	}
	duration := time.Since(start)

	resp := computeResponse{
		Mode:       modeName(parallel),
		DurationMs: duration.Milliseconds(),
		Points:     points,
		Count:      len(points),
		Requested:  requested,
	}

	writeJSON(w, resp)
}

func normalizeCount(val int) int {
	const (
		defaultCount = 5000
		minCount     = 100
		maxCount     = 1000000000
	)

	if val <= 0 {
		return defaultCount
	}
	if val < minCount {
		return minCount
	}
	if val > maxCount {
		return maxCount
	}
	return val
}

func modeName(parallel bool) string {
	if parallel {
		return "parallel"
	}
	return "single-thread"
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(payload)
}

func generateAndMapSequential(count int) []point {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	points := make([]point, 0, count)
	limit := count * 15
	attempts := 0

	for len(points) < count && attempts < limit {
		attempts++
		if p, ok := generatePoint(rng); ok {
			points = append(points, p)
		}
	}
	return points
}

func generateAndMapParallel(count int) []point {
	workerCount := runtime.NumCPU()
	if workerCount < 2 {
		workerCount = 2
	}
	if workerCount > count {
		workerCount = count
	}

	pointsCh := make(chan point, workerCount*4)
	var wg sync.WaitGroup

	var attempts int64
	var produced int64
	limit := int64(count * 20)
	target := int64(count)

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			rng := rand.New(rand.NewSource(time.Now().UnixNano() + int64(id)))
			for {
				if atomic.LoadInt64(&produced) >= target {
					return
				}
				if atomic.AddInt64(&attempts, 1) > limit {
					return
				}

				p, ok := generatePoint(rng)
				if !ok {
					continue
				}

				current := atomic.AddInt64(&produced, 1)
				if current > target {
					return
				}
				pointsCh <- p
			}
		}(i)
	}

	go func() {
		wg.Wait()
		close(pointsCh)
	}()

	points := make([]point, 0, count)
	for p := range pointsCh {
		points = append(points, p)
	}

	log.Printf("parallel mapping used %d workers for %d points", workerCount, len(points))
	return points
}

func generatePoint(rng *rand.Rand) (point, bool) {
	const (
		reMin = -4.0
		reMax = 4.0
		imMin = -2.0
		imMax = 5.0
	)

	re := reMin + rng.Float64()*(reMax-reMin)
	im := imMin + rng.Float64()*(imMax-imMin)

	if math.Abs(re) < 0.05 && im > -0.05 && im < 1.05 {
		return point{}, false
	}

	z := complexNumber{Re: re, Im: im}
	return mapAndDecorate(z)
}

func mapZtoW(z complexNumber) (complexNumber, bool) {
	iz := complexNumber{Re: -z.Im, Im: z.Re}
	den := complexNumber{Re: iz.Re + 1, Im: iz.Im}
	if modulus(den) < 0.0001 {
		return complexNumber{}, false
	}

	frac := divide(iz, den)
	root := fourthRoot(frac)
	result := multiply(root, complexNumber{Re: 0, Im: 1})

	if math.IsInf(result.Re, 0) || math.IsInf(result.Im, 0) || math.IsNaN(result.Re) || math.IsNaN(result.Im) {
		return complexNumber{}, false
	}
	return result, true
}

func colorFor(z complexNumber) string {
	angle := math.Atan2(z.Im, z.Re)
	hue := ((angle + math.Pi) / (2 * math.Pi)) * 360
	return fmt.Sprintf("hsla(%.2f, 100%%, 60%%, 0.8)", hue)
}

func mapAndDecorate(z complexNumber) (point, bool) {
	w, ok := mapZtoW(z)
	if !ok {
		return point{}, false
	}

	// extra CPU work to make the parallel path visibly faster on large batches
	acc := 0.0
	for i := 0; i < extraWorkIterations; i++ {
		f := 0.0001 * float64(i+1)
		acc += math.Sin(w.Re*f) + math.Cos(w.Im*f)
	}
	_ = acc

	return point{
		Z:     z,
		W:     w,
		Color: colorFor(z),
	}, true
}

func modulus(z complexNumber) float64 {
	return math.Hypot(z.Re, z.Im)
}

func divide(a, b complexNumber) complexNumber {
	den := b.Re*b.Re + b.Im*b.Im
	if den == 0 {
		return complexNumber{Re: math.Inf(1), Im: math.Inf(1)}
	}
	return complexNumber{
		Re: (a.Re*b.Re + a.Im*b.Im) / den,
		Im: (a.Im*b.Re - a.Re*b.Im) / den,
	}
}

func multiply(a, b complexNumber) complexNumber {
	return complexNumber{
		Re: a.Re*b.Re - a.Im*b.Im,
		Im: a.Re*b.Im + a.Im*b.Re,
	}
}

func fourthRoot(z complexNumber) complexNumber {
	r := modulus(z)
	phi := math.Atan2(z.Im, z.Re)
	rNew := math.Pow(r, 0.25)
	phiNew := phi / 4
	return complexNumber{
		Re: rNew * math.Cos(phiNew),
		Im: rNew * math.Sin(phiNew),
	}
}
