#!/usr/bin/env node
// The server side of a feed-load run (feed-load.mjs): nm-api's request rate by response class, its
// CPU, and Cloud SQL's CPU and connections over the run's window, read from Cloud Monitoring with the
// build's own token (the metadata server). A builder without monitoring.viewer gets a 403: then this
// prints the window and the reads to make by hand, and exits 0, because the load numbers stand alone.
//
//   FEED_LOAD_REPORT=<feed-load JSON>  OUT=<path>  [PROJECT_ID]  [NM_API_SERVICE=nm-api]  [SQL_INSTANCE=nm-e2e-pg]
import { readFileSync, writeFileSync } from 'node:fs';

const project = process.env.PROJECT_ID ?? 'galonge-sandbox-04';
const service = process.env.NM_API_SERVICE ?? 'nm-api';
const instance = process.env.SQL_INSTANCE ?? 'nm-e2e-pg';
const load = JSON.parse(readFileSync(process.env.FEED_LOAD_REPORT ?? '/workspace/feed-load.json', 'utf8'));
const out = { window: load.window, project, service, instance, series: {}, errors: [] };
if (!load.window?.start) {
  console.log('no window in the load report: nothing to read');
  process.exit(0);
}

async function token() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'metadata-flavor': 'Google' } });
  if (!r.ok) throw new Error(`metadata token ${r.status}`);
  return (await r.json()).access_token;
}

/** one timeSeries.list, reduced to [{labels, points: [[iso, value]]}] */
async function read(name, filter, aggregation) {
  const q = new URLSearchParams({ filter, 'interval.startTime': load.window.start, 'interval.endTime': load.window.end });
  for (const [k, v] of Object.entries(aggregation)) {
    for (const item of [v].flat()) q.append(`aggregation.${k}`, item);
  }
  const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`, { headers: { authorization: `Bearer ${await token()}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`${name}: ${r.status} ${body?.error?.message ?? ''}`), { status: r.status });
  out.series[name] = (body.timeSeries ?? []).map((s) => ({
    labels: { ...(s.metric?.labels ?? {}) },
    points: (s.points ?? []).map((p) => [p.interval.endTime, p.value.doubleValue ?? Number(p.value.int64Value ?? 0)]).reverse(),
  }));
}

const reads = [
  ['nm-api requests/s by class', `metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="${service}"`,
    { alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_RATE', crossSeriesReducer: 'REDUCE_SUM', groupByFields: 'metric.labels.response_code_class' }],
  ['nm-api CPU p95', `metric.type="run.googleapis.com/container/cpu/utilizations" AND resource.type="cloud_run_revision" AND resource.labels.service_name="${service}"`,
    { alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX' }],
  ['nm-api request latency p95 ms', `metric.type="run.googleapis.com/request_latencies" AND resource.type="cloud_run_revision" AND resource.labels.service_name="${service}"`,
    { alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX' }],
  ['Cloud SQL CPU', `metric.type="cloudsql.googleapis.com/database/cpu/utilization" AND resource.type="cloudsql_database" AND resource.labels.database_id="${project}:${instance}"`,
    { alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_MEAN' }],
  ['Cloud SQL connections', `metric.type="cloudsql.googleapis.com/database/postgresql/num_backends" AND resource.type="cloudsql_database" AND resource.labels.database_id="${project}:${instance}"`,
    { alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_MEAN', crossSeriesReducer: 'REDUCE_SUM' }],
];

let denied = false;
for (const [name, filter, agg] of reads) {
  try { await read(name, filter, agg); } catch (e) { out.errors.push(e.message); if (e.status === 403) denied = true; }
}
if (denied) {
  out.manual = `The builder may not read Cloud Monitoring. Read these metrics for ${load.window.start} to ${load.window.end}: `
    + reads.map(([n]) => n).join(', ');
}
const json = JSON.stringify(out, null, 2);
console.log(json);
if (process.env.OUT) writeFileSync(process.env.OUT, json);
