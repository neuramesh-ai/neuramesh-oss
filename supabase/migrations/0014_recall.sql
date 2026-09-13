-- Recall (docs/03 §6): hybrid retrieval over channel messages — pgvector HNSW
-- for semantic, generated tsvector + GIN for lexical, fused with RRF in the
-- control-api. Embeddings come from a local ONNX model (no inference keys).
create extension if not exists vector;

alter table messages add column embedding vector(384);
alter table messages add column fts tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index messages_fts on messages using gin (fts);
create index messages_embedding on messages using hnsw (embedding vector_cosine_ops);
