package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A body that cannot be encoded must not be reported as a success. Streaming
// straight to the writer would have sent 200 before discovering the problem,
// leaving the client a truncated document under a header promising a whole
// one — which is worse than an error, because it looks like data.
func TestAnUnencodableBodyIsNotReportedAsSuccess(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, make(chan int))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("writeJSON with an unencodable body = %d, want %d",
			rec.Code, http.StatusInternalServerError)
	}
}
