package collections

import (
	"context"
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
	OwnerID     uuid.UUID
	ParentID    *uuid.UUID
	Name        string
	Description *string
}

type UpdateInput struct {
	ParentID    *uuid.UUID
	Name        *string
	Description *string
}

func (r *Repository) Create(ctx context.Context, in CreateInput) (*models.Collection, error) {
	const q = `
		INSERT INTO collections (owner_id, parent_id, name, description)
		VALUES ($1, $2, $3, $4)
		RETURNING id, owner_id, parent_id, name, description, created_at, updated_at`
	row := r.pool.QueryRow(ctx, q, in.OwnerID, in.ParentID, in.Name, in.Description)
	return scanCollection(row)
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*models.Collection, error) {
	const q = `
		SELECT id, owner_id, parent_id, name, description, created_at, updated_at
		FROM collections WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	c, err := scanCollection(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("collection not found")
		}
		return nil, err
	}
	return c, nil
}

func (r *Repository) List(ctx context.Context, ownerID uuid.UUID) ([]models.Collection, error) {
	const q = `
		SELECT id, owner_id, parent_id, name, description, created_at, updated_at
		FROM collections WHERE owner_id = $1 ORDER BY name ASC`
	rows, err := r.pool.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Collection
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *Repository) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (*models.Collection, error) {
	c, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if c.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}

	if in.Name != nil {
		c.Name = *in.Name
	}
	if in.Description != nil {
		c.Description = in.Description
	}
	if in.ParentID != nil {
		c.ParentID = in.ParentID
	}

	const q = `
		UPDATE collections SET name=$2, description=$3, parent_id=$4, updated_at=now()
		WHERE id=$1
		RETURNING id, owner_id, parent_id, name, description, created_at, updated_at`
	row := r.pool.QueryRow(ctx, q, id, c.Name, c.Description, c.ParentID)
	return scanCollection(row)
}

func (r *Repository) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM collections WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("collection not found")
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanCollection(row scannable) (*models.Collection, error) {
	var c models.Collection
	err := row.Scan(&c.ID, &c.OwnerID, &c.ParentID, &c.Name, &c.Description, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}
