import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitFor(predicate, message = 'Expected operation did not start') {
  for (let i = 0; i < 250; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}
