package utils

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// DownloadAudience uses only the configured API origin. Never send service credentials to caller-supplied URLs.
func DownloadAudience(filePath string) (string, error) {
	const prefix = "/uploads/bot_users/"
	if !strings.HasPrefix(filePath, prefix) {
		return "", fmt.Errorf("invalid audience path")
	}
	filename := strings.TrimPrefix(filePath, prefix)
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]+\.txt$`).MatchString(filename) {
		return "", fmt.Errorf("invalid audience filename")
	}
	baseURL := strings.TrimRight(os.Getenv("MAIN_SERVICE_URL"), "/")
	secret := os.Getenv("SECRET_KEY")
	if baseURL == "" || secret == "" {
		return "", fmt.Errorf("MAIN_SERVICE_URL and SECRET_KEY are required")
	}
	req, err := http.NewRequest(http.MethodGet, baseURL+"/internal/audiences/"+filename, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("x-request-secret", secret)
	client := &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("audience download failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("audience download returned HTTP %d", response.StatusCode)
	}
	file, err := os.CreateTemp("", "audience_*.txt")
	if err != nil {
		return "", err
	}
	defer file.Close()
	const maxSize = 20 * 1024 * 1024
	size, err := io.Copy(file, io.LimitReader(response.Body, maxSize+1))
	if err != nil || size > maxSize {
		os.Remove(file.Name())
		return "", fmt.Errorf("audience download failed or exceeds 20 MiB")
	}
	return file.Name(), nil
}
