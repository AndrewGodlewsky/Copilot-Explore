import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, isAbsolute, sep } from 'node:path';
import { directoryState } from './storage-context.mjs';

const exec = promisify(execFile), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unavailable = () => Error('The active project checkout changed or Git is unavailable. Review the intended local repository again.');

/** Identity only: no status scan, source read, repository mutation or lazy fetch. */
export async function readProjectCheckout(reader, { expectedRoot, signal } = {}) {
  const end = Date.now() + 5000;
  const guard = () => { signal?.throwIfAborted(); if (Date.now() >= end) throw unavailable(); };
  const working = await reader.root(); guard();
  if (expectedRoot && !same(working, expectedRoot)) throw unavailable();
  const read = async (args, optional = false) => {
    guard();
    try {
      const result = await exec('git', ['--no-pager', '--no-optional-locks', '--no-lazy-fetch', '-C', working.path, '-c', 'core.fsmonitor=false', ...args], {
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
        windowsHide: true, timeout: Math.max(1, end - Date.now()), maxBuffer: 65536, signal,
      });
      guard(); return result.stdout.trim();
    } catch (error) { guard(); if (optional && error.code === 1 && error.stdout === '') return null; throw unavailable(); }
  };
  const path = await read(['rev-parse', '--show-toplevel']), checkout = await directoryState(path), part = relative(checkout.path, working.path); guard();
  if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) throw unavailable();
  const branch = await read(['symbolic-ref', '--quiet', 'HEAD'], true), head = await read(['rev-parse', '--verify', '--quiet', 'HEAD'], true);
  if ((!branch && !head) || branch !== null && !/^refs\/[^\x00-\x20\x7f]+$/.test(branch) || head !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw unavailable();
  if (!same(working, await reader.root()) || !same(checkout, await directoryState(path))) throw unavailable(); guard();
  return { ...checkout, git: { branch, head } };
}
