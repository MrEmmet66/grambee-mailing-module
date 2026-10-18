package ratelimiter

import "testing"

func TestSimpleLimiterDefaults(t *testing.T) {
	l := NewSimpleSleepRateLimiter("mailing-1")

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

func TestSimpleLimiterIncreasesRateAfterThreshold(t *testing.T) {
	l := NewSimpleSleepRateLimiter("mailing-1")

	for i := 0; i < 100; i++ {
		l.OnProcessed()
	}

	if got := l.GetCurrentRate(); got != 27 {
		t.Fatalf("current rate = %v, want 27 after the increase threshold", got)
	}
}

func TestSimpleLimiterReducesRateOnFloodWait(t *testing.T) {
	l := NewSimpleSleepRateLimiter("mailing-1")

	l.OnFloodWait(30)

	if got := l.GetCurrentRate(); got != 20 {
		t.Fatalf("current rate = %v, want 20 after FLOOD_WAIT", got)
	}
	if got := l.GetMaxRate(); got != 58 {
		t.Fatalf("max rate = %v, want 58 after FLOOD_WAIT", got)
	}
	if l.floodWaitCount != 1 {
		t.Fatalf("flood wait count = %v, want 1", l.floodWaitCount)
	}
}

func TestSimpleLimiterHonoursFloor(t *testing.T) {
	l := NewSimpleSleepRateLimiter("mailing-1")

	for i := 0; i < 20; i++ {
		l.OnFloodWait(1)
	}

	if got := l.GetCurrentRate(); got != 15 {
		t.Fatalf("current rate = %v, want the 15 msg/s floor", got)
	}
}
