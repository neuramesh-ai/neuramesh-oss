-- Provenance belongs to immutable brain uploads. Existing files keep their original history.
alter table brain_artifacts add column capture jsonb
  check (capture is null or (jsonb_typeof(capture)='object' and capture ?& array['source','name','target']
    and capture->>'source' in ('managed-browser','independent-observer')));
