// Synthetic metadata only; no Copilot session, catalog request or inference.
export async function fixtureResearchModels() {
  return { models: [{ id: 'fixture-model', name: 'Fixture model' }, { id: 'fixture-dedicated', name: 'Dedicated fixture 🌿' }], selectedId: 'fixture-model', account: { isAuthenticated: true, login: 'fixture', host: 'github.com' } };
}
