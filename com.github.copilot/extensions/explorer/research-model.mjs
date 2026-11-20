export const validResearchModelId = value => typeof value === 'string' && value.length <= 128 && !value.includes('://') && /^[a-z0-9][a-z0-9._:+\/-]*$/i.test(value);
export const eligibleCopilotModel = model => model?.provider?.kind === 'copilot' && validResearchModelId(model.id) && (!model.policy || model.policy.state === 'enabled');
export const sameCopilotAccount = (a, b) => a?.isAuthenticated === true && b?.isAuthenticated === true && typeof a.login === 'string' && !!a.login && typeof a.host === 'string' && !!a.host && a.login.toLowerCase() === b.login?.toLowerCase() && a.host.toLowerCase() === b.host?.toLowerCase();

// This private projection is never prompt context. Only models/selectedId reach settings UI.
export function researchModelCatalog(catalog, selected, auth) {
  if (auth?.isAuthenticated !== true || ![auth.login, auth.host].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{C}]/u.test(value))) throw Error('Sign in to Copilot before choosing a Research model.');
  if (!Array.isArray(catalog?.list) || catalog.list.length > 500) throw Error('The Copilot model catalog is unavailable. Refresh Research model settings.');
  const ids = new Set(), models = [];
  for (const item of catalog.list) {
    if (!validResearchModelId(item?.id) || ids.has(item.id)) throw Error('The Copilot model catalog is invalid. Refresh Research model settings.');
    ids.add(item.id);
    if (eligibleCopilotModel(item)) models.push(Object.freeze({ id: item.id, name: typeof item.name === 'string' && item.name.trim() && item.name.length <= 200 && !/\p{C}/u.test(item.name) ? item.name : item.id }));
  }
  return Object.freeze({ models: Object.freeze(models), selectedId: validResearchModelId(selected?.modelId) ? selected.modelId : null, account: Object.freeze({ isAuthenticated: true, login: auth.login.toLowerCase(), host: auth.host.toLowerCase() }) });
}

export function captureResearchModel(metadata, settings) {
  const mode = settings.modelId === null ? 'chat' : 'dedicated', id = settings.modelId ?? metadata.selectedId;
  const model = metadata.models.find(item => item.id === id);
  if (!model) throw Error(mode === 'chat' ? 'The selected chat model is unavailable for Research. Select an enabled Copilot model or choose a dedicated Research model in Settings.' : 'The dedicated model is unavailable for this account or policy. Choose a replacement or Use selected chat model in Research model settings.');
  return Object.freeze({ mode, revision: settings.revision, model, account: metadata.account });
}

export const sameResearchModel = (a, b) => a?.mode === b?.mode && a?.revision === b?.revision && a?.model?.id === b?.model?.id && sameCopilotAccount(a?.account, b?.account);
export const researchModelSummary = capture => ({ mode: capture.mode, id: capture.model.id, name: capture.model.name });
