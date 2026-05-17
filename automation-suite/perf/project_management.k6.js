/**
 * Suite : project_management
 * Layer : Performance (k6)
 * Owner : ZAC Platform QA
 *
 * SLOs (default - override via env):
 *   - p95 latency on GET /api/projects     <  500 ms
 *   - error rate                            <  1 %
 *   - VUs                                    50  (ramp 30s -> hold 1m -> ramp-down 15s)
 *
 * Run locally:
 *   k6 run perf/project_management.k6.js \
 *     -e ZAC_API_BASE_URL=http://localhost:3000/api
 *
 * Run in CI:
 *   k6 run --out json=reports/k6/project_management.json perf/project_management.k6.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = (__ENV.ZAC_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const VUS = parseInt(__ENV.K6_VUS || '50', 10);
const DURATION = __ENV.K6_DURATION || '1m';
const P95_MS = parseInt(__ENV.K6_P95_THRESHOLD_MS || '500', 10);

const errors = new Rate('zac_errors');
const listLatency = new Trend('zac_list_projects_ms', true);

export const options = {
  scenarios: {
    list_projects: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
      tags: { endpoint: 'list_projects' },
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'zac_errors':      ['rate<0.01'],
    'http_req_duration{endpoint:list_projects}': [`p(95)<${P95_MS}`],
    'zac_list_projects_ms': [`p(95)<${P95_MS}`],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const probe = http.get(`${BASE}/health`);
  if (probe.status !== 200) {
    throw new Error(`ZAC server not healthy at ${BASE}/health: ${probe.status}`);
  }
  return { base: BASE };
}

export default function (data) {
  group('GET /projects', () => {
    const res = http.get(`${data.base}/projects`, {
      tags: { endpoint: 'list_projects' },
      headers: { Accept: 'application/json' },
    });
    listLatency.add(res.timings.duration);

    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'success=true':  (r) => r.json('success') === true,
      'projects is array': (r) => Array.isArray(r.json('projects')),
    });
    errors.add(!ok);
  });

  sleep(0.3);
}

export function teardown() {
  // No created state in this scenario; nothing to tear down.
}
