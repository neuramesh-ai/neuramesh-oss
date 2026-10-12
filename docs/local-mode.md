# Local mode

The local stack runs NeuraMesh on a machine you own. Two containers do the work: Postgres
and the NeuraMesh control API. The app uses a durable SQLite cache and an API change feed. Your code, your keys, and your data stay on that machine.
The desktop app installs and drives the stack for you. This page is for the manual path: you start
the stack from a terminal, or you run it on a server you own.

Local mode is Free. Every plan gate lifts on the local stack. The stored plan stays Free, and the
app says Free. The starter brain is not part of the local stack. Add your own model key.

## What you need

- A container engine with the `docker compose` plugin. Colima, OrbStack, and Docker Desktop all work.
- Docker Desktop is free for personal use and for companies with fewer than 250 people or less than
  10 million dollars in revenue. Above that, Docker Desktop needs a paid subscription. Colima and
  OrbStack have their own terms.
- About 1 GB of disk for the two images, plus your data.

## The files

The desktop app writes two files into `~/.neuramesh/local/`. For the manual path, copy them from
the repository:

| File | Source |
|---|---|
| `docker-compose.yaml` | `apps/desktop/resources/local/docker-compose.yaml` |
| `.env` | Write it by hand from the table in the next section. |

Keep `.env` at mode 0600. It holds the bearer hash and optional storage configuration.

## The env file

| Variable | What it is | How to make it |
|---|---|---|
| `NM_IMAGE_TAG` | The control API image tag. It is the app version, for example `0.133.0`. | Read it from the app, or from the root `package.json`. |
| `NM_LOCAL_DIR` | The absolute path of the folder that holds the stack. | `~/.neuramesh/local`, written out in full. |
| `NM_LOCAL_HUMAN_TOKEN_HASH` | The sha256 hex of your bearer. | See the next section. |
| `NM_API_PORT` | The host port for the control API. Default `8788`. | Pick a free port. |
| `NM_IMAGE` | Optional. The image name without its tag. | Leave it unset to use the published image. |

### Your bearer

You are the one human on the local stack. Your credential is a bearer of the form `nmh_` and 48 hex
characters. The app mints it and keeps it in the keychain. On the manual path you mint it:

```bash
TOKEN="nmh_$(openssl rand -hex 24)"
echo "$TOKEN"
printf %s "$TOKEN" | shasum -a 256 | cut -d ' ' -f 1
```

Put the second line in your password manager. Put the third line in `.env` as
`NM_LOCAL_HUMAN_TOKEN_HASH`. Only the hash reaches the container. Every request to the control API
carries `Authorization: Bearer <your token>`.

Agents do not use your bearer. The app gives each agent-authored request the bearer plus an
`x-nm-actor` header that names the agent. The control API checks that the agent belongs to your
workspace. A request with only an `x-nm-actor` header and no bearer gets a 401.

To replace a lost bearer, mint a new one, write its hash into `.env`, and restart the stack. The
control API stores the new hash at boot. The old bearer stops working.

## Start the stack

```bash
cd ~/.neuramesh/local
docker compose pull
docker compose up -d --wait
```

The first start takes about a minute. The control API applies every migration to the empty Postgres,
seeds your user, and serves the local replica API. The app downloads a consistent snapshot and
then applies ordered changes. Pending messages remain in a durable local outbox.

Check it:

```bash
curl -s http://127.0.0.1:8788/healthz
curl -s http://127.0.0.1:8788/.well-known/nm-config
curl -s http://127.0.0.1:8788/v1/me -H "authorization: Bearer $TOKEN"
```

`nm-config` returns the mode, version, schema version, and legacy `powersyncUrl: null` field. `version` is the
app version the image was built from. `schemaVersion` is the last migration the runner applied.

## Ports

| Port | Service | Binds to |
|---|---|---|
| `NM_API_PORT` (8788) | control API | `127.0.0.1` only |
| none | Postgres | Not published. Only the API container can reach it. |

To reach a stack on a server, put your own TLS proxy or an SSH tunnel in front of the API port. The
stack does not terminate TLS.

The app checks the API port before it starts a container. To use another port, set
`NM_LOCAL_API_PORT` before the app starts. Local mode does not reserve a PowerSync port.

## Your data

Postgres writes to `~/.neuramesh/local/pgdata/`. Brain transcripts and artifact bytes use
`~/.neuramesh/local/brain-objects/`. Both folders survive container replacement.
The app keeps its SQLite cache in the brain's `state/` folder.

Back up `~/.neuramesh/local/` like any other folder. Time Machine sees it. Stop the stack first for a
consistent copy: `docker compose stop`, then copy, then `docker compose start`.

Never run `docker compose down -v`. The `-v` flag deletes volumes. This stack uses bind mounts, so the
flag has nothing to delete, but the habit is dangerous on other stacks. The app never runs it.

## Update

A new app version is a new image tag. Change `NM_IMAGE_TAG` in `.env`, then:

```bash
docker compose pull
docker compose up -d --wait
```

The control API applies the new migrations at boot. The new replica keeps the prior PowerSync file
and drains its pending writes through the existing HTTP command path before cutover. The desktop
app does this for you when its version changes.

## Optional GCS storage

Local mode stores object bytes on disk by default. To select GCS, set both fields in the local
`.env` file, then restart the app:

```dotenv
NM_BRAIN_GCS_BUCKET=your-private-brain-bucket
NM_BRAIN_ADC_FILE=/absolute/path/to/application_default_credentials.json
```

The app adds `docker-compose.gcs.yaml` only for this explicit choice. It mounts the ADC file
read-only. The API uses Google Application Default Credentials. It does not require a `gcloud`
binary in the container. Grant that identity access only to the selected private bucket.
A missing ADC file stops startup with a clear error. The app does not silently change storage.

For a manual stack, copy the GCS override from `apps/desktop/resources/local/` and include it:

```bash
docker compose -f docker-compose.yaml -f docker-compose.gcs.yaml up -d --wait
```

Keep the local object mount after enabling GCS. Existing filesystem objects remain readable
on that stack while new objects go to GCS. Changing the setting does not copy older bytes to GCS;
back up and migrate those deliberately before removing the local folder.

## Stop

`docker compose stop` stops the containers and keeps your data. `docker compose start` brings them
back in a few seconds. The app stops the stack when you quit, unless you turn that off in Settings.

## Connect the app

The desktop app connects to its own local stack on its own. To connect to a stack on another
machine, open Settings, then Connections, then Add a server. Choose the `custom` kind and enter:

- the API URL, for example `https://nm.example.com`
- your bearer

The app calls `/.well-known/nm-config` to confirm the stack, then `/v1/me` to learn your user id,
then `/v1/sync/bootstrap` and `/v1/sync/changes` with the same verified bearer.

## Environment the control API reads

The compose file sets these. They are listed here for a run by hand.

| Variable | Value | Effect |
|---|---|---|
| `NM_LOCAL` | `1` | Local mode. Baked into the image. |
| `NM_BRAIN_STORAGE_DIR` | `/brain-objects` | Durable filesystem objects when GCS is not selected. |
| `DATABASE_URL` | the Postgres URL | Required. The stack never runs on a memory store. |
| `NM_LOCAL_HUMAN_TOKEN_HASH` | sha256 hex | Your bearer's hash. Required. |
| `NM_ALLOW_ACTOR_HEADER` | `0` | The bare `x-nm-actor` lane stays closed. |
| `FLEET_AUTOPROVISION` | `off` | No cloud machines. |
| `PUSH_ENABLED` | `0` | No phone push. |
| `NM_MAIL_DRY_RUN` | `1` | Mail is logged, never sent. |

The image sets `NM_LOCAL`, `FLEET_AUTOPROVISION`, `PUSH_ENABLED`, `NM_MAIL_DRY_RUN`, and
`NM_ALLOW_ACTOR_HEADER` itself. A run of the image is the local stack, with or without compose.

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| `control-api` restarts and its log ends with `NM_LOCAL_HUMAN_TOKEN_HASH must be the sha256 hex` | The hash is missing or malformed in `.env`. | Mint a bearer and write its hash. |
| A container restarts forever, and `docker inspect` shows `"Networks": {}` | Its first start failed on a taken port. Docker Desktop then drops the container's network, and every later start runs it with no network at all. The app removes such a container by itself and says which. | `docker compose rm -sf <service>`, then `up -d` again. Never `down -v`. |
| The app says a container stopped N times | The container is in a restart loop. The card shows its last log line. | Press Try again. The app starts a fresh container. `docker compose logs <service>` has the whole log. |
| `docker compose up` prints `set NM_LOCAL_DIR to the folder that holds this stack` | A required variable is missing from `.env`. | The message names it. |
| `/v1/me` returns 401 | The bearer does not match the hash. | Check the hash, or mint a new bearer. |

`docker compose logs -f` shows both containers.
