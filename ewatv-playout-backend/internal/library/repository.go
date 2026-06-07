package library

import (
	"context"
	"fmt"
	"strings"

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

type CreateVideoInput struct {
	OwnerID      uuid.UUID
	CollectionID *uuid.UUID
	Title        string
	Description  *string
	SourceType   models.VideoSource
	SourceRef    string
	Tags         []string
	Category     *string
	Daypart      models.Daypart
	HideOverlay  bool
	AutoSubs     bool
}

type UpdateVideoInput struct {
	Title        *string
	Description  *string
	CollectionID *uuid.UUID
	Tags         []string
	Category     *string
	Daypart      *models.Daypart
	HideOverlay  *bool
	AutoSubs     *bool
}

func (r *Repository) Create(ctx context.Context, in CreateVideoInput) (*models.Video, error) {
	if in.SourceType == "" {
		in.SourceType = models.VideoSourceDirectURL
	}
	if in.Daypart == "" {
		in.Daypart = models.DaypartAny
	}
	const q = `
		INSERT INTO videos (
			owner_id, collection_id, title, description, source_type, source_ref,
			tags, category, daypart, hide_overlay, auto_subs, pack_status
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
		RETURNING id, owner_id, collection_id, title, description, length_sec,
			source_type, source_ref, storage_path, width, height, codec_video, codec_audio,
			thumbnail_path, pack_status, tags, category, daypart, hide_overlay, auto_subs,
			created_at, updated_at`

	row := r.pool.QueryRow(ctx, q,
		in.OwnerID, in.CollectionID, in.Title, in.Description, in.SourceType, in.SourceRef,
		in.Tags, in.Category, in.Daypart, in.HideOverlay, in.AutoSubs,
	)
	return scanVideo(row)
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*models.Video, error) {
	const q = `SELECT id, owner_id, collection_id, title, description, length_sec,
		source_type, source_ref, storage_path, width, height, codec_video, codec_audio,
		thumbnail_path, pack_status, tags, category, daypart, hide_overlay, auto_subs,
		created_at, updated_at FROM videos WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	v, err := scanVideo(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("video not found")
		}
		return nil, err
	}
	return v, nil
}

type ListFilter struct {
	OwnerID      uuid.UUID
	CollectionID *uuid.UUID
	Search       string
	Limit        int
	Offset       int
}

func (r *Repository) List(ctx context.Context, f ListFilter) ([]models.Video, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	args := []any{f.OwnerID}
	where := []string{"owner_id = $1"}

	if f.CollectionID != nil {
		args = append(args, *f.CollectionID)
		where = append(where, fmt.Sprintf("collection_id = $%d", len(args)))
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		args = append(args, "%"+s+"%")
		n := len(args)
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR description ILIKE $%d OR category ILIKE $%d)", n, n, n))
	}

	args = append(args, f.Limit, f.Offset)
	q := fmt.Sprintf(`SELECT id, owner_id, collection_id, title, description, length_sec,
		source_type, source_ref, storage_path, width, height, codec_video, codec_audio,
		thumbnail_path, pack_status, tags, category, daypart, hide_overlay, auto_subs,
		created_at, updated_at FROM videos WHERE %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		strings.Join(where, " AND "), len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Video
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (r *Repository) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateVideoInput) (*models.Video, error) {
	v, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if v.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}

	if in.Title != nil {
		v.Title = *in.Title
	}
	if in.Description != nil {
		v.Description = in.Description
	}
	if in.CollectionID != nil {
		v.CollectionID = in.CollectionID
	}
	if in.Tags != nil {
		v.Tags = in.Tags
	}
	if in.Category != nil {
		v.Category = in.Category
	}
	if in.Daypart != nil {
		v.Daypart = *in.Daypart
	}
	if in.HideOverlay != nil {
		v.HideOverlay = *in.HideOverlay
	}
	if in.AutoSubs != nil {
		v.AutoSubs = *in.AutoSubs
	}

	const q = `UPDATE videos SET title=$2, description=$3, collection_id=$4, tags=$5,
		category=$6, daypart=$7, hide_overlay=$8, auto_subs=$9, updated_at=now()
		WHERE id=$1 RETURNING id, owner_id, collection_id, title, description, length_sec,
		source_type, source_ref, storage_path, width, height, codec_video, codec_audio,
		thumbnail_path, pack_status, tags, category, daypart, hide_overlay, auto_subs,
		created_at, updated_at`

	row := r.pool.QueryRow(ctx, q, id, v.Title, v.Description, v.CollectionID, v.Tags,
		v.Category, v.Daypart, v.HideOverlay, v.AutoSubs)
	return scanVideo(row)
}

func (r *Repository) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM videos WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("video not found")
	}
	return nil
}

func (r *Repository) UpdateProbe(ctx context.Context, id uuid.UUID, lengthSec int, width, height *int, cv, ca *string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE videos SET length_sec=$2, width=$3, height=$4, codec_video=$5, codec_audio=$6, updated_at=now()
		WHERE id=$1`, id, lengthSec, width, height, cv, ca)
	return err
}

func (r *Repository) UpdatePackStatus(ctx context.Context, id uuid.UUID, status string, storagePath *string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE videos SET pack_status=$2, storage_path=COALESCE($3, storage_path), updated_at=now()
		WHERE id=$1`, id, status, storagePath)
	return err
}

func (r *Repository) EnqueueIngest(ctx context.Context, videoID uuid.UUID) (uuid.UUID, error) {
	var jobID uuid.UUID
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ingest_jobs (video_id, status) VALUES ($1, 'queued') RETURNING id`, videoID).Scan(&jobID)
	return jobID, err
}

func (r *Repository) ClaimNextIngestJob(ctx context.Context) (jobID, videoID uuid.UUID, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	err = tx.QueryRow(ctx, `
		SELECT j.id, j.video_id FROM ingest_jobs j
		INNER JOIN videos v ON v.id = j.video_id
		WHERE j.status = 'queued' AND v.pack_status IN ('pending', 'failed')
		ORDER BY j.created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1`).Scan(&jobID, &videoID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return uuid.Nil, uuid.Nil, nil
		}
		return uuid.Nil, uuid.Nil, err
	}

	_, err = tx.Exec(ctx, `UPDATE ingest_jobs SET status='running', started_at=now() WHERE id=$1`, jobID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE videos SET pack_status='processing', updated_at=now() WHERE id=$1`, videoID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return jobID, videoID, nil
}

func (r *Repository) FinishIngestJob(ctx context.Context, jobID uuid.UUID, ok bool, errMsg *string) error {
	status := "completed"
	if !ok {
		status = "failed"
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE ingest_jobs SET status=$2, error_message=$3, finished_at=now() WHERE id=$1`,
		jobID, status, errMsg)
	return err
}

type scannable interface {
	Scan(dest ...any) error
}

func scanVideo(row scannable) (*models.Video, error) {
	var v models.Video
	var st string
	var dp string
	err := row.Scan(
		&v.ID, &v.OwnerID, &v.CollectionID, &v.Title, &v.Description, &v.LengthSec,
		&st, &v.SourceRef, &v.StoragePath, &v.Width, &v.Height, &v.CodecVideo, &v.CodecAudio,
		&v.ThumbnailPath, &v.PackStatus, &v.Tags, &v.Category, &dp, &v.HideOverlay, &v.AutoSubs,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	v.SourceType = models.VideoSource(st)
	v.Daypart = models.Daypart(dp)
	return &v, nil
}
