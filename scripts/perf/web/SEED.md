# The perf-lab seed

`seed.mjs` creates the data the frame journeys need, in the dev user's first workspace on the dev
stack. It writes through the control-api command path (`POST /v1/commands` and
`POST /v1/messages` with the actor header), so the events and the projected rows stay correct.
It records the ids it created in `seed.json` (git-ignored: the ids belong to one dev database).

| What | Contents |
|---|---|
| Room `#perf-lab` | topic "Performance harness data. Safe to delete." |
| Thread "perf-lab · long thread" (chat mode) | 401 messages: 400 message bodies sampled evenly from the workspace's own messages, in their original order, then one closing agent line |
| Thread "perf-lab · reply target" (chat mode) | 6 short messages. **Every reply-arrival run appends one ~6 KB agent message here.** |

The sample takes bodies of 1 to 12,000 characters with no `‹…›` card marker and no `nm` code
fence (nmq, nms, nmauth), so the seed mints no decision rows and no needs-you items. Human bodies
post as the dev user with their @mentions defused (`@rex` becomes `rex`). Agent bodies keep their
agent when it is a live agent of the workspace, and use the orchestrator otherwise.

The long thread is never written after the seed, so the scroll and view-switch journeys always
see the same 401 messages. The reply-target thread grows by one message for each reply-arrival
run. That does not change what the journey measures (the time to paint one new message).

## Delete it

`channel.delete` is human-only and purges the room's messages and threads. Take the room id from
`seed.json`:

```sh
curl -sS -X POST http://127.0.0.1:8841/v1/commands -H 'content-type: application/json' \
  -H 'x-nm-actor: {"kind":"human","id":"00000000-0000-0000-0000-000000000001"}' \
  -d "{\"type\":\"channel.delete\",\"channel\":\"$(node -p "require('./seed.json').channel")\"}"
```

Any control-api on the dev stack with `NM_ALLOW_ACTOR_HEADER=1` works. 8841 is the harness's.
