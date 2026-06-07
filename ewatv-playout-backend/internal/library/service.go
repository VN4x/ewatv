package library

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, ownerID uuid.UUID, in CreateVideoInput) (*models.Video, error) {
	in.OwnerID = ownerID
	v, err := s.repo.Create(ctx, in)
	if err != nil {
		return nil, err
	}
	_, _ = s.repo.EnqueueIngest(ctx, v.ID)
	return v, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (*models.Video, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) List(ctx context.Context, f ListFilter) ([]models.Video, error) {
	return s.repo.List(ctx, f)
}

func (s *Service) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateVideoInput) (*models.Video, error) {
	return s.repo.Update(ctx, id, ownerID, in)
}

func (s *Service) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	return s.repo.Delete(ctx, id, ownerID)
}

func (s *Service) Reingest(ctx context.Context, id, ownerID uuid.UUID) (*models.Video, error) {
	v, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if v.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}
	_ = s.repo.UpdatePackStatus(ctx, id, "pending", nil)
	jobID, err := s.repo.EnqueueIngest(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = jobID
	return s.repo.GetByID(ctx, id)
}
