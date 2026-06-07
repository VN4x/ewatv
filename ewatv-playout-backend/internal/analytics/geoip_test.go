package analytics

import "testing"

func TestCountryFromHeaders(t *testing.T) {
	got := CountryFromHeaders(map[string]string{"CF-IPCountry": "fi"})
	if got != "FI" {
		t.Fatalf("got %q want FI", got)
	}
	if CountryFromHeaders(map[string]string{}) != "" {
		t.Fatal("expected empty")
	}
}

func TestHashUserAgentStable(t *testing.T) {
	a := HashUserAgent("Mozilla/5.0 test")
	b := HashUserAgent("Mozilla/5.0 test")
	if a == "" || a != b {
		t.Fatalf("hash unstable: %q vs %q", a, b)
	}
	if HashUserAgent("") != "" {
		t.Fatal("empty ua should hash to empty")
	}
}
