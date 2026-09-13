-- A project's repo can now be a GitHub/GitLab URL *or* a local folder on the user's
-- machine (the local folder also sets the code-viewer home). Local repos have no
-- clone_url, so it becomes nullable; local_path holds the absolute folder path.
alter table repos alter column clone_url drop not null;
alter table repos add column local_path text;
