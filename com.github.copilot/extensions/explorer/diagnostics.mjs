const pick = (value, choices, fallback = 'unknown') => choices.includes(value) ? value : fallback;
const state = value => pick(value, ['ready', 'unsupported', 'unavailable', 'unknown']);
const count = value => Number.isSafeInteger(value) ? Math.max(0, Math.min(500, value)) : 0;
export const diagnosticError = error => error?.code === 'DIAGNOSTIC_LIMIT' ? 'source-limit' : error?.code === 'VOICE_DEVICE' ? 'device-unavailable' : 'inspection-failed';

// Construct every field. Never serialize a source object, error, snapshot or log.
export function supportBundle(source = {}) {
  const h = source.host ?? {}, s = source.speech ?? {}, helpers = source.helpers ?? {}, r = source.recovery ?? {};
  const bundle = {
    schemaVersion: 1,
    pluginVersion: typeof source.pluginVersion === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(source.pluginVersion) ? source.pluginVersion : 'unknown',
    desktopVersion: 'unknown',
    host: { runtime: state(h.runtime), sdk: state(h.sdk), protocol: Number.isSafeInteger(h.protocol) && h.protocol > 0 && h.protocol < 1000 ? h.protocol : null, account: state(h.account), model: state(h.model) },
    speech: { runtime: state(s.runtime), model: state(s.model), microphone: state(s.microphone), loadability: 'unknown', capture: 'unknown', modelCount: count(s.modelCount), deviceCount: count(s.deviceCount), error: pick(s.error, ['none', 'source-limit', 'device-unavailable', 'inspection-failed'], 'inspection-failed') },
    helpers: { research: state(helpers.research), toolFree: state(helpers.toolFree), researchRelease: pick(helpers.researchRelease, ['unconfirmed', 'no-current-blocker']), toolFreeRelease: pick(helpers.toolFreeRelease, ['unconfirmed', 'no-current-blocker']), execution: 'unknown' },
    recovery: { save: pick(r.save, ['failed', 'committed']), export: pick(r.export, ['active', 'failed', 'interrupted', 'response-finished']) },
  };
  return JSON.stringify(bundle, null, 2) + '\n';
}

export class Diagnostics {
  constructor({ version, explorer, voice, readHost = async () => ({}), timeoutMs = 12000 }) {
    this.version = version; this.explorer = explorer; this.voice = voice; this.readHost = readHost; this.timeoutMs = timeoutMs;
  }
  async inspect(retry = false) {
    if (!this.flight && (!this.cached || retry)) {
      const flight = {};
      this.flight = flight;
      let timer;
      const work = Promise.allSettled([Promise.resolve().then(() => this.readHost()), Promise.resolve().then(() => this.voice?.diagnostics?.())]);
      flight.visible = Promise.race([
        work.then(([host, speech]) => ({ host: host.status === 'fulfilled' ? host.value : {}, speech: speech.status === 'fulfilled' ? speech.value : {} })),
        new Promise(resolve => { timer = setTimeout(() => resolve({}), this.timeoutMs); }),
      ]).then(value => { clearTimeout(timer); this.cached = value; });
      // A response deadline does not cancel RPC/filesystem work. Retain ownership
      // until actual completion, and never publish an expired pass's late result.
      void work.then(() => flight.visible).finally(() => { if (this.flight === flight) this.flight = null; });
    }
    if (this.flight) await this.flight.visible;
    const host = this.cached?.host ?? {}, explorer = this.explorer;
    const prerequisite = explorer.closed ? 'unavailable' : ['runtime', 'sdk', 'account', 'model'].every(key => host[key] === 'ready') ? 'ready'
      : ['runtime', 'sdk', 'account', 'model'].some(key => host[key] === 'unsupported') ? 'unsupported'
        : ['runtime', 'sdk', 'account', 'model'].some(key => host[key] === 'unavailable') ? 'unavailable' : 'unknown';
    return JSON.parse(supportBundle({ pluginVersion: this.version, ...this.cached,
      helpers: { research: explorer.unconfirmedResearchRelease ? 'unavailable' : prerequisite, toolFree: explorer.unconfirmedToolFreeRelease ? 'unavailable' : prerequisite,
        researchRelease: explorer.unconfirmedResearchRelease ? 'unconfirmed' : 'no-current-blocker', toolFreeRelease: explorer.unconfirmedToolFreeRelease ? 'unconfirmed' : 'no-current-blocker' },
      recovery: { save: explorer.recoveryNotice?.status, export: explorer.exportObservation?.status },
    }));
  }
}
