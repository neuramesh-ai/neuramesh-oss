-- Subscription auth for model providers. A provider credential is now either an API key
-- (auth_mode='apikey', token = the key) OR a marker that the user prefers their local CLI
-- subscription login (auth_mode='subscription', token null — the real secret lives in
-- ~/.claude / ~/.codex / ~/.gemini on each machine and never reaches NeuraMesh). auth_mode
-- is non-secret metadata; resolution prefers a detected subscription over a key.
alter table provider_credentials
  add column auth_mode text not null default 'apikey' check (auth_mode in ('apikey', 'subscription'));

alter table provider_credentials alter column token drop not null;

-- apikey rows must carry a token; subscription rows must not need one.
alter table provider_credentials
  add constraint provider_credentials_token_required_for_apikey
  check (auth_mode = 'subscription' or token is not null);
