# Local mode

The local stack runs NeuraMesh on a machine you own. Three containers do the work: Postgres,
PowerSync, and the NeuraMesh control API. Your code, your keys, and your data stay on that machine.
The desktop app installs and drives the stack for you. This page is for the manual path: you start
the stack from a terminal, or you run it on a server you own.

Local mode is Free. Every plan gate lifts on the local stack. The stored plan stays Free, and the
app says Free. The starter brain is not part of the local stack. Add your own model key.

## What you need

- A container engine with the `docker compose` plugin. Colima, OrbStack, and Docker Desktop all work.
- Docker Desktop is free for personal use and for companies with fewer than 250 people or less than
  10 million dollars in revenue. Above that, Docker Desktop needs a paid subscription. Colima and
  OrbStack have their own terms.
- About 1 GB of disk for the three images, plus your data.

## The files

The desktop app writes two files into `~/.neuramesh/local/`. For the manual path, copy them from
the repository:

| File | Source |
|---|---|
| `docker-compose.yaml` | `apps/desktop/resources/local/docker-compose.yaml` |
| `.env` | Write it by hand from the table in the next section. |

Keep `.env` at mode 0600. It holds the sync key and the admin token.

## The env file

| Variable | What it is | How to make it |
|---|---|---|
| `NM_IMAGE_TAG` | The control API image tag. It is the app version, for example `0.133.0`. | Read it from the app, or from the root `package.json`. |
| `NM_LOCAL_DIR` | The absolute path of the folder that holds the stack. | `~/.neuramesh/local`, written out in full. |
| `NM_SYNC_KEY` | 32 random bytes, base64url. The control API signs sync tokens with it. PowerSync checks them with it. | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` |
| `NM_ADMIN_TOKEN` | A random string for PowerSync's admin API. | `openssl rand -hex 24` |
| `NM_LOCAL_HUMAN_TOKEN_HASH` | The sha256 hex of your bearer. | See the next section. |
| `NM_API_PORT` | The host port for the control API. Default `8788`. | Pick a free port. |
| `NM_POWERSYNC_PORT` | The host port for PowerSync. Default `58081`. | Pick a free port. |
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
creates the PowerSync storage role and publication, writes the PowerSync config into
`~/.neuramesh/local/powersync/`, and seeds your user. PowerSync starts after that.

Check it:

```bash
curl -s http://127.0.0.1:8788/healthz
curl -s http://127.0.0.1:8788/.well-known/nm-config
curl -s http://127.0.0.1:8788/v1/me -H "authorization: Bearer $TOKEN"
```

`nm-config` returns `{ "mode": "local", "powersyncUrl", "version", "schemaVersion" }`. `version` is the
app version the image was built from. `schemaVersion` is the last migration the runner applied.

## Ports

| Port | Service | Binds to |
|---|---|---|
| `NM_API_PORT` (8788) | control API | `127.0.0.1` only |
| `NM_POWERSYNC_PORT` (58081) | PowerSync | `127.0.0.1` only |
| none | Postgres | Not published. Only the two containers reach it. |

To reach a stack on a server, put your own TLS proxy or an SSH tunnel in front of both ports. The
stack does not terminate TLS.

The app checks both ports before it starts a container. A port that another container or program
holds is one card: "Port 58081 is in use by another program", with the holder named. Stop that
program, then press Try again. To run the app on other ports, start it with `NM_LOCAL_API_PORT`
and `NM_LOCAL_POWERSYNC_PORT` in its environment. On a machine that runs the repository's dev
stack (`dev/stack`), its PowerSync holds `127.0.0.1:58081`, so the packaged app and the dev stack
do not run at the same time on the default ports.

## Your data

Postgres writes to `~/.neuramesh/local/pgdata/`. PowerSync's config lives in
`~/.neuramesh/local/powersync/`. PowerSync keeps its own state in Postgres, in the `powersync_storage`
database, so it needs no disk of its own.

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

The control API applies the new migrations at boot and writes the new PowerSync config. The desktop
app does this for you when its version changes.

## Stop

`docker compose stop` stops the containers and keeps your data. `docker compose start` brings them
back in a few seconds. The app stops the stack when you quit, unless you turn that off in Settings.

## Connect the app

The desktop app connects to its own local stack on its own. To connect to a stack on another
machine, open Settings, then Connections, then Add a server. Choose the `custom` kind and enter:

- the API URL, for example `https://nm.example.com`
- the PowerSync URL, for example `https://sync.example.com`
- your bearer

The app calls `/.well-known/nm-config` to confirm the stack, then `/v1/me` to learn your user id,
then `/auth/local/token` for its sync token.

## Environment the control API reads

The compose file sets these. They are listed here for a run by hand.

| Variable | Value | Effect |
|---|---|---|
| `NM_LOCAL` | `1` | Local mode. Baked into the image. |
| `DATABASE_URL` | the Postgres URL | Required. The stack never runs on a memory store. |
| `NM_LOCAL_HUMAN_TOKEN_HASH` | sha256 hex | Your bearer's hash. Required. |
| `NM_SYNC_KEY` | base64url | The sync token key. |
| `NM_POWERSYNC_URL` | `http://127.0.0.1:<port>` | What `nm-config` and `/auth/local/token` report as the PowerSync endpoint. |
| `NM_POWERSYNC_CONFIG_DIR` | a path | Where the image writes `powersync.yaml` and `sync-config.yaml` at boot. |
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
| `powersync` never becomes healthy | It waits for the control API. Read the control API log first. | `docker compose logs control-api` |
| A container restarts forever, and `docker inspect` shows `"Networks": {}` | Its first start failed on a taken port. Docker Desktop then drops the container's network, and every later start runs it with no network at all. The app removes such a container by itself and says which. | `docker compose rm -sf <service>`, then `up -d` again. Never `down -v`. |
| The app says a container stopped N times | The container is in a restart loop. The card shows its last log line. | Press Try again. The app starts a fresh container. `docker compose logs <service>` has the whole log. |
| `docker compose up` prints `set NM_LOCAL_DIR to the folder that holds this stack` | A required variable is missing from `.env`. | The message names it. |
| `/auth/local/token` returns 503 | `NM_SYNC_KEY` is not set. | Fill it in `.env` and restart. |
| `/v1/me` returns 401 | The bearer does not match the hash. | Check the hash, or mint a new bearer. |

`docker compose logs -f` shows all three containers.
