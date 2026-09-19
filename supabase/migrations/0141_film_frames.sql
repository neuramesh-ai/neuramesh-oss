-- The frame (docs/design/brand-grounding-2026-09 §6): a video post can name an image on its
-- room's shelf, and the film shows that screen instead of an interface the model invents. The
-- films row records which image the door was asked for and whether the lane took it (a model
-- without a reference lane films without it and says so on the card).
alter table films
  add column if not exists frame      text,
  add column if not exists frame_used boolean not null default false;
comment on column films.frame is 'the shelf image the draft named as its frame (by name), null when none';
comment on column films.frame_used is 'true when the film was submitted to a reference lane with that image';
