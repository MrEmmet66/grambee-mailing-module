package utils

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompletionCallbackRequiresAndSendsCredentials(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("x-request-secret") != "test-key" {
			t.Error("missing service credentials")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("SECRET_KEY", "")
	if err := SendMailingCompletion(server.URL, "test", 1, 0); err == nil {
		t.Fatal("accepted missing credentials")
	}
	if calls != 0 {
		t.Fatal("sent an unauthenticated request")
	}
	t.Setenv("SECRET_KEY", "test-key")
	if err := SendMailingCompletion(server.URL, "test", 1, 0); err != nil {
		t.Fatal(err)
	}
}
