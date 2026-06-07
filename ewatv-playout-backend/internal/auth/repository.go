package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRecord struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	DisplayName  *string
	Role         string
	CreatedAt    time.Time
}

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) CreateUser(ctx context.Context, email, passwordHash string, displayName *string, role string) (*UserRecord, error) {
	if role == "" {
		role = "user"
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertUser = `
		INSERT INTO users (email, password_hash, display_name)
		VALUES ($1, $2, $3)
		RETURNING id, email, password_hash, display_name, created_at`

	var rec UserRecord
	err = tx.QueryRow(ctx, insertUser, email, passwordHash, displayName).Scan(
		&rec.ID, &rec.Email, &rec.PasswordHash, &rec.DisplayName, &rec.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	_, err = tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1, $2::user_role)`, rec.ID, role)
	if err != nil {
		return nil, fmt.Errorf("insert role: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	rec.Role = role
	return &rec, nil
}

func (r *Repository) GetByEmail(ctx context.Context, email string) (*UserRecord, error) {
	const q = `
		SELECT u.id, u.email, u.password_hash, u.display_name, u.created_at,
			COALESCE(
				(SELECT ur.role::text FROM user_roles ur WHERE ur.user_id = u.id ORDER BY ur.role LIMIT 1),
				'user'
			)
		FROM users u
		WHERE u.email = $1`

	rec, err := scanUserRecord(r.pool.QueryRow(ctx, q, email))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, err
	}
	return rec, nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*UserRecord, error) {
	const q = `
		SELECT u.id, u.email, u.password_hash, u.display_name, u.created_at,
			COALESCE(
				(SELECT ur.role::text FROM user_roles ur WHERE ur.user_id = u.id ORDER BY ur.role LIMIT 1),
				'user'
			)
		FROM users u
		WHERE u.id = $1`

	rec, err := scanUserRecord(r.pool.QueryRow(ctx, q, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, err
	}
	return rec, nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanUserRecord(row scannable) (*UserRecord, error) {
	var rec UserRecord
	if err := row.Scan(&rec.ID, &rec.Email, &rec.PasswordHash, &rec.DisplayName, &rec.CreatedAt, &rec.Role); err != nil {
		return nil, err
	}
	return &rec, nil
}
