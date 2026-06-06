package channels

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

type CreateInput struct {
	OwnerID          uuid.UUID
	Name             string
	Slug             string
	StreamName       string
	Timezone         string
	OverlayLogoURL   *string
	FallbackURL      *string
	Settings         json.RawMessage
	PlayoutActive    bool
}

type UpdateInput struct {
	Name           *string
	Slug           *string
	StreamName     *string
	Timezone       *string
	OverlayLogoURL *string
	FallbackURL    *string
	Settings       json.RawMessage
	PlayoutActive  *bool
}

func (r *Repository) Create(ctx context.Context, in CreateInput) (*models.Channel, error) {
	if in.Timezone == "" {
		in.Timezone = "Europe/Helsinki"
	}
	if in.StreamName == "" {
		in.StreamName = in.Slug
	}
	settings := in.Settings
	if len(settings) == 0 {
		settings = json.RawMessage(`{}`)
	}
	playout := ParsePlayoutSettings(settings)
	playout.PlayoutActive = in.PlayoutActive
	settings = MergePlayoutPatch(settings, PlayoutPatch{PlayoutActive: &in.PlayoutActive})

	const q = `
		INSERT INTO channels (
			owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at`

	row := r.pool.QueryRow(ctx, q,
		in.OwnerID, in.Name, in.Slug, in.StreamName, in.Timezone,
		in.OverlayLogoURL, in.FallbackURL, settings, playout.PlayoutActive,
	)
	return scanChannel(row)
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*models.Channel, error) {
	const q = `
		SELECT id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at
		FROM channels WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	ch, err := scanChannel(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("channel not found")
		}
		return nil, err
	}
	return ch, nil
}

func (r *Repository) GetBySlug(ctx context.Context, slug string) (*models.Channel, error) {
	const q = `
		SELECT id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at
		FROM channels WHERE slug = $1`
	row := r.pool.QueryRow(ctx, q, slug)
	ch, err := scanChannel(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("channel not found")
		}
		return nil, err
	}
	return ch, nil
}

func (r *Repository) List(ctx context.Context, ownerID uuid.UUID) ([]models.Channel, error) {
	const q = `
		SELECT id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at
		FROM channels WHERE owner_id = $1 ORDER BY name ASC`
	rows, err := r.pool.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Channel
	for rows.Next() {
		ch, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ch)
	}
	return out, rows.Err()
}

func (r *Repository) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (*models.Channel, error) {
	ch, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}

	if in.Name != nil {
		ch.Name = *in.Name
	}
	if in.Slug != nil {
		ch.Slug = *in.Slug
	}
	if in.StreamName != nil {
		ch.StreamName = *in.StreamName
	}
	if in.Timezone != nil {
		ch.Timezone = *in.Timezone
	}
	if in.OverlayLogoURL != nil {
		ch.OverlayLogoURL = in.OverlayLogoURL
	}
	if in.FallbackURL != nil {
		ch.FallbackURL = in.FallbackURL
	}
	if len(in.Settings) > 0 {
		ch.Settings = in.Settings
	}
	if in.PlayoutActive != nil {
		ch.PlayoutActive = *in.PlayoutActive
		patch := PlayoutPatch{PlayoutActive: in.PlayoutActive}
		ch.Settings = MergePlayoutPatch(ch.Settings, patch)
	}

	const q = `
		UPDATE channels SET
			name=$2, slug=$3, stream_name=$4, timezone=$5,
			overlay_logo_url=$6, fallback_youtube_url=$7, settings=$8,
			playout_active=$9, updated_at=now()
		WHERE id=$1
		RETURNING id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at`

	row := r.pool.QueryRow(ctx, q, id,
		ch.Name, ch.Slug, ch.StreamName, ch.Timezone,
		ch.OverlayLogoURL, ch.FallbackURL, ch.Settings, ch.PlayoutActive,
	)
	return scanChannel(row)
}

func (r *Repository) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM channels WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanChannel(row scannable) (*models.Channel, error) {
	var ch models.Channel
	err := row.Scan(
		&ch.ID, &ch.OwnerID, &ch.Name, &ch.Slug, &ch.StreamName, &ch.Timezone,
		&ch.OverlayLogoURL, &ch.FallbackURL, &ch.Settings, &ch.PlayoutActive,
		&ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &ch, nil
}
