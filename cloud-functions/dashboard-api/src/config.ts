import { defineString } from 'firebase-functions/params';

const DASHBOARD_USER_ID = defineString('DASHBOARD_USER_ID', {
  default: 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1',
});

export function getDashboardUserId(): string {
  return DASHBOARD_USER_ID.value();
}
