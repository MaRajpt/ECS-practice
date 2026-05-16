import http from 'k6/http';
import { sleep } from 'k6';

const TARGET = __ENV.TARGET_URL || 'http://localhost';

export const options = {
  vus:      parseInt(__ENV.VUS || '50'),
  duration: __ENV.DURATION    || '10m',
};

export default function () {
  http.get(`${TARGET}/health`);
  sleep(1);
}
