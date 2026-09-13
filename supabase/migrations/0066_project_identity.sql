-- Project identity: an optional website + a small logo shown in the project switcher,
-- settings, and composer chip. The logo is detected LOCALLY on the user's machine
-- (site icons via apple-touch-icon/link-rel/manifest, or logo files in the repo folder)
-- and stored as a compact data: URL (icon resized to ≤128px, far under the inline sync
-- cap) — the server never fetches URLs. Synced to clients via `select * from projects`.
alter table projects add column website text;
alter table projects add column logo_url text;
