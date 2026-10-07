-- Where an artifact's bytes came from, when the platform made it from a source that a person
-- controls (George, 2026-10-06: a product shot in a film is a real app screenshot, never an
-- agent's web capture or drawn picture). `repo:<owner>/<name>/<path>@<sha>` is written by
-- POST /v1/repo/shelve alone, which reads the file from the project's repository through the
-- GitHub App. No command sets it. A product shot may show an image that a person created
-- (created_by_kind = 'human') or one whose source names a repository file (store/frames.ts).
alter table artifacts add column if not exists source text;
