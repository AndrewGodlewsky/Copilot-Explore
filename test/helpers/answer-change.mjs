/** Explicit user confirmation for existing scenarios whose answer changes have consequences. */
export async function confirmAnswer(explorer, input) {
  const preview = await explorer.answerChangeRequest({ action: 'prepare', journey: explorer.activeKey ?? explorer.doc.id, ...input });
  return explorer.command('answer', { ...input, answerPreview: preview.token, confirmConsequences: true });
}
