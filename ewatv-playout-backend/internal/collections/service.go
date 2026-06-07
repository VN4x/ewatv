package collections

import (
	"context"

	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, ownerID uuid.UUID, in CreateInput) (*models.Collection, error) {
	in.OwnerID = ownerID
	return s.repo.Create(ctx, in)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (*models.Collection, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) List(ctx context.Context, ownerID uuid.UUID) ([]models.Collection, error) {
	return s.repo.List(ctx, ownerID)
}

func (s *Service) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (*models.Collection, error) {
	return s.repo.Update(ctx, id, ownerID, in)
}

func (s *Service) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	return s.repo.Delete(ctx, id, ownerID)
}
