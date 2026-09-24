package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/sorolens/sorolens/apps/api/internal/store"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestGetExpiringStorage_FiltersAndSorts(t *testing.T) {
	st := store.NewMockStore()
	h := &Handler{
		Store:  st,
		Logger: testLogger(),
	}

	contractID := "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

	// Setup contract and sync state
	_ = st.UpsertContract(context.Background(), store.Contract{
		ID:      contractID,
		Network: "testnet",
		Status:  "active",
	})
	_ = st.UpsertSyncState(context.Background(), store.SyncState{
		ContractID: contractID,
		LastLedger: 1000,
	})

	// Add storage entries:
	// currentLedger = 1000.
	// Entry 1: live_until_ledger = 1050 (50 ledgers remaining = 250s) -> within 86400s
	// Entry 2: live_until_ledger = 1010 (10 ledgers remaining = 50s) -> within 86400s
	// Entry 3: live_until_ledger = 50000 (49000 ledgers remaining = 245,000s) -> NOT within 86400s
	_ = st.UpsertStorageEntries(context.Background(), []store.StorageEntry{
		{
			ContractID:      contractID,
			KeyXDR:          "key-1",
			KeyDecoded:      "user_balance",
			ValueXDR:        "val-1",
			Durability:      "temporary",
			LiveUntilLedger: 1050,
			Status:          "live",
		},
		{
			ContractID:      contractID,
			KeyXDR:          "key-2",
			KeyDecoded:      "nonce",
			ValueXDR:        "val-2",
			Durability:      "instance",
			LiveUntilLedger: 1010,
			Status:          "live",
		},
		{
			ContractID:      contractID,
			KeyXDR:          "key-3",
			KeyDecoded:      "admin_key",
			ValueXDR:        "val-3",
			Durability:      "persistent",
			LiveUntilLedger: 50000,
			Status:          "live",
		},
	})

	r := chi.NewRouter()
	r.Get("/api/v1/contracts/{id}/storage/expiring", h.GetExpiringStorage)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/"+contractID+"/storage/expiring?within=86400", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		ContractID    string                 `json:"contract_id"`
		CurrentLedger uint32                 `json:"current_ledger"`
		WithinSeconds int64                  `json:"within_seconds"`
		Count         int                    `json:"count"`
		Entries       []storageEntryResponse `json:"entries"`
	}

	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if res.Count != 2 {
		t.Fatalf("expected 2 expiring entries, got %d", res.Count)
	}

	// Verify order: soonest to expire first (key-2 at 1010, then key-1 at 1050)
	if res.Entries[0].KeyXDR != "key-2" {
		t.Errorf("first entry key = %q, want key-2 (soonest to expire)", res.Entries[0].KeyXDR)
	}
	if res.Entries[1].KeyXDR != "key-1" {
		t.Errorf("second entry key = %q, want key-1", res.Entries[1].KeyXDR)
	}

	if res.Entries[0].LedgersUntilExpiry == nil || *res.Entries[0].LedgersUntilExpiry != 10 {
		t.Errorf("first entry ledgers until expiry = %v, want 10", res.Entries[0].LedgersUntilExpiry)
	}
}

func TestListContracts_ReturnsExpiringKeysCount(t *testing.T) {
	st := store.NewMockStore()
	h := &Handler{
		Store:  st,
		Logger: testLogger(),
	}

	contractID := "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

	_ = st.UpsertContract(context.Background(), store.Contract{
		ID:      contractID,
		Network: "testnet",
		Status:  "active",
		AddedAt: time.Now(),
	})
	_ = st.UpsertSyncState(context.Background(), store.SyncState{
		ContractID: contractID,
		LastLedger: 1000,
	})
	_ = st.UpsertStorageEntries(context.Background(), []store.StorageEntry{
		{
			ContractID:      contractID,
			KeyXDR:          "key-1",
			LiveUntilLedger: 1050, // within 7 days
			Status:          "live",
		},
	})

	r := chi.NewRouter()
	r.Get("/api/v1/contracts", h.ListContracts)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var res struct {
		Contracts []contractResponse `json:"contracts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if len(res.Contracts) != 1 {
		t.Fatalf("expected 1 contract, got %d", len(res.Contracts))
	}
	if res.Contracts[0].ExpiringKeysCount != 1 {
		t.Errorf("expiring keys count = %d, want 1", res.Contracts[0].ExpiringKeysCount)
	}
}
