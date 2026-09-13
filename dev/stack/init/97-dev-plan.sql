-- The dev sandbox runs on the Cloud plan. The smoke's multi-machine sections (the synthetic
-- off-host reviewer worker, shared compute) register a second machine for the same member,
-- which the free plan's one-machine-per-member cap (0114) rightly refuses — that cap's own
-- behavior is covered by the pg suite, which sets 'free' explicitly where it matters
-- (invites.pg.test.ts). Applied by 00-bootstrap.sh after every migration, so the plan column exists.
update workspaces set plan = 'cloud' where id = 'a0000000-0000-0000-0000-00000000000a';
