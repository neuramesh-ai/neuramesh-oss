-- Review cockpit: diffs render from artifacts so review works cross-machine
-- and offline (docs/02). Small text artifacts inline; Storage uploads later.
alter table artifacts add column inline_content text;
alter table artifacts alter column storage_path drop not null;
