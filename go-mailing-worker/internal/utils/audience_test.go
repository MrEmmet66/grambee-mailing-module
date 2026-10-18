package utils

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestDownloadAudienceAuthenticatesToConfiguredAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/internal/audiences/demo.txt" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("x-request-secret") != "test-service-key" {
			t.Error("missing service credentials")
		}
		w.Write([]byte("123456789\n"))
	}))
	defer server.Close()
	t.Setenv("MAIN_SERVICE_URL", server.URL+"/api/v1")
	t.Setenv("SECRET_KEY", "test-service-key")
	filename, err := DownloadAudience("/uploads/bot_users/demo.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(filename)
	content, _ := os.ReadFile(filename)
	if string(content) != "123456789\n" {
		t.Fatal("unexpected audience content")
	}
}

func TestDownloadAudienceRejectsExternalURLsAndTraversal(t *testing.T) {
	for _, value := range []string{"https://example.com/a.txt", "/uploads/bot_users/../secret.txt", "/uploads/bot_users/a/b.txt", "/etc/passwd"} {
		if _, err := DownloadAudience(value); err == nil {
			t.Errorf("accepted untrusted path: %s", value)
		}
	}
}

func TestDownloadAudienceDoesNotFollowRedirects(t *testing.T) {
	leaked := false
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer external.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, external.URL, http.StatusFound) }))
	defer server.Close()
	t.Setenv("MAIN_SERVICE_URL", server.URL)
	t.Setenv("SECRET_KEY", "test-service-key")
	if _, err := DownloadAudience("/uploads/bot_users/demo.txt"); err == nil {
		t.Fatal("followed redirect")
	}
	if leaked {
		t.Fatal("credentials sent outside configured API")
	}
}
