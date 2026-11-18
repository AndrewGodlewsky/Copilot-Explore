const escape = value => String(value).replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');

export function scenarioExportNote(label, identities = true) {
  return `Scenario at export: ${label.classification}. Scope: ${label.scope}. Preference revision: ${label.preferenceRevision}.\n` +
    (label.classification === 'hypothetical' ? 'Conditional alternative; not a current project decision.\n' : label.classification === 'unselected' ? 'No preferred scenario was selected.\n' : 'This source was preferred when exported.\n') +
    'This label describes the export, not the preference when older research or artifacts were created. Answer certainty and review warnings still apply.' +
    (identities ? `\nSource identity: ${JSON.stringify(label.source)}\nRecorded family: ${JSON.stringify(label.family)}` : '\nOriginal source identifiers are omitted from this selected visual copy.');
}

export function scenarioMarkdown(content, label) {
  return scenarioExportNote(label).split('\n').map(line => `> ${escape(line)}`).join('\n') + '\n\n' + content;
}
