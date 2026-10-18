package ratelimiter

import (
	"testing"
	"time"
)

func TestNewAdaptiveRateLimiterDefaults(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	if got := l.GetCurrentRate(); got != 25 {
		t.Fatalf("current rate = %v, want 25", got)
	}
	if got := l.GetMaxRate(); got != 60 {
		t.Fatalf("max rate = %v, want 60", got)
	}
	if l.minRate != 15 {
		t.Fatalf("min rate = %v, want 15", l.minRate)
	}
}

func TestOnProcessedIncreasesRateAfterThreshold(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	for i := 0; i < 100; i++ {
		l.OnProcessed()
	}

	if got := l.GetCurrentRate(); got != 27 {
		t.Fatalf("current rate = %v, want 27 after the increase threshold", got)
	}
	if l.totalProcessed != 100 {
		t.Fatalf("total processed = %v, want 100", l.totalProcessed)
	}
}

func TestOnProcessedNeverExceedsMaxRate(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	for i := 0; i < 5000; i++ {
		l.OnProcessed()
	}

	if got := l.GetCurrentRate(); got > l.GetMaxRate() {
		t.Fatalf("current rate %v exceeds max rate %v", got, l.GetMaxRate())
	}
	if got := l.GetCurrentRate(); got != 60 {
		t.Fatalf("current rate = %v, want it to climb up to 60", got)
	}
}

func TestOnFloodWaitReducesRates(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	l.OnFloodWait(30)

	if got := l.GetCurrentRate(); got != 20 {
		t.Fatalf("current rate = %v, want 20 after one FLOOD_WAIT", got)
	}
	if got := l.GetMaxRate(); got != 48 {
		t.Fatalf("max rate = %v, want 48 after one FLOOD_WAIT", got)
	}
	if l.floodWaitCount != 1 {
		t.Fatalf("flood wait count = %v, want 1", l.floodWaitCount)
	}
}

func TestOnFloodWaitIsDebounced(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	l.OnFloodWait(3600)
	first := l.GetCurrentRate()

	// A second FLOOD_WAIT inside the debounce window must not lower the rate again.
	l.OnFloodWait(3600)

	if got := l.GetCurrentRate(); got != first {
		t.Fatalf("rate changed on a debounced FLOOD_WAIT: %v -> %v", first, got)
	}
	if l.floodWaitCount != 1 {
		t.Fatalf("flood wait count = %v, want 1", l.floodWaitCount)
	}
}

func TestOnFloodWaitHonoursFloor(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	for i := 0; i < 20; i++ {
		l.lastFloodWaitTime = time.Now().Add(-time.Hour) // bypass the debounce guard
		l.OnFloodWait(1)
	}

	if got := l.GetCurrentRate(); got != 2 {
		t.Fatalf("current rate = %v, want the 2 msg/s floor", got)
	}
	if got := l.GetMaxRate(); got != 2 {
		t.Fatalf("max rate = %v, want the 2 msg/s floor", got)
	}
}

func TestOnErrorDropsPendingSuccesses(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	for i := 0; i < 20; i++ {
		l.OnProcessed()
	}
	l.OnError()

	// A plain error removes 10 pending successes without changing the rate.
	if l.successCount != 10 {
		t.Fatalf("success count = %v, want 10", l.successCount)
	}
	if got := l.GetCurrentRate(); got != 25 {
		t.Fatalf("current rate = %v, want it to stay at 25", got)
	}
}

func TestGetStatsReportsCounters(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	for i := 0; i < 10; i++ {
		l.OnProcessed()
	}
	l.OnFloodWait(5)

	stats := l.GetStats()

	if stats["total_processed"] != 10 {
		t.Fatalf("stats total_processed = %v, want 10", stats["total_processed"])
	}
	if stats["flood_wait_count"] != 1 {
		t.Fatalf("stats flood_wait_count = %v, want 1", stats["flood_wait_count"])
	}
}

func TestResetRestoresInitialValues(t *testing.T) {
	l := NewAdaptiveRateLimiter("mailing-1")

	l.OnFloodWait(60)
	l.Reset()

	if got := l.GetCurrentRate(); got != 25 {
		t.Fatalf("current rate = %v, want 25 after reset", got)
	}
	if got := l.GetMaxRate(); got != 60 {
		t.Fatalf("max rate = %v, want 60 after reset", got)
	}
	if l.floodWaitCount != 0 {
		t.Fatalf("flood wait count = %v, want 0 after reset", l.floodWaitCount)
	}
}
