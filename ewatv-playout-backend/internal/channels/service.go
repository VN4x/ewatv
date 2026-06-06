package channels

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

func (s *Service) Create(ctx context.Context, ownerID uuid.UUID, in CreateInput) (*models.Channel, error) {
	in.OwnerID = ownerID
	if in.Slug == "" {
		return nil, fmt.Errorf("slug required")
	}
	if in.Name == "" {
		return nil, fmt.Errorf("name required")
	}
	return s.repo.Create(ctx, in)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (*models.Channel, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) GetBySlug(ctx context.Context, slug string) (*models.Channel, error) {
	return s.repo.GetBySlug(ctx, slug)
}

func (s *Service) List(ctx context.Context, ownerID uuid.UUID) ([]models.Channel, error) {
	return s.repo.List(ctx, ownerID)
}

func (s *Service) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (*models.Channel, error) {
	return s.repo.Update(ctx, id, ownerID, in)
}

func (s *Service) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	return s.repo.Delete(ctx, id, ownerID)
}

// PlayoutSettings returns parsed playout settings for a channel.
func (s *Service) PlayoutSettings(ch *models.Channel) PlayoutSettings {
	return ParsePlayoutSettings(ch.Settings)
}

// ApplyPlayoutPatch merges playout settings and updates the channel row.
func (s *Service) ApplyPlayoutPatch(ctx context.Context, id, ownerID uuid.UUID, patch PlayoutPatch) (*models.Channel, PlayoutSettings, error) {
	ch, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, PlayoutSettings{}, err
	}
	if ch.OwnerID != ownerID {
		return nil, PlayoutSettings{}, fmt.Errorf("forbidden")
	}

	settings := MergePlayoutPatch(ch.Settings, patch)
	playout := ParsePlayoutSettings(settings)
	var playoutActive *bool
	if patch.PlayoutActive != nil {
		v := playout.PlayoutActive
		playoutActive = &v
	}

	updated, err := s.repo.Update(ctx, id, ownerID, UpdateInput{
		Settings:      settings,
		PlayoutActive: playoutActive,
	})
	if err != nil {
		return nil, PlayoutSettings{}, err
	}
	return updated, ParsePlayoutSettings(updated.Settings), nil
}
