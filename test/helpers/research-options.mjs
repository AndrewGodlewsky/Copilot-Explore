export function optionFindings() {
  return {
    optionsVersion: 1, basis: 'reasoning', summary: 'Choose a storage arrangement for a small neighborhood library.',
    options: [
      { id: 'cupboard', title: 'Use one shared cupboard', description: 'Keep the pilot collection together with two key holders.',
        fit: 'Fits a small collection when neighbors can reach one location.', pros: ['Simple handovers with one inventory'], cons: ['Access depends on key holders'],
        proposedAnswer: 'I will pilot one shared cupboard with two key holders.', details: [{ label: 'Review', value: 'Review access after one month.' }] },
      { id: 'distributed', title: 'Keep tools with their owners', description: 'Arrange loans directly with each owner.',
        fit: 'Fits scattered neighbors who can coordinate individual collection times.', pros: ['No shared storage space needed'], cons: ['More separate arrangements for each loan'],
        proposedAnswer: 'I will keep tools with their owners and coordinate each loan.', details: [] },
    ], recommendation: 'Consider the cupboard for a small pilot; check access first.', uncertainty: 'Local access and costs remain unconfirmed.', sources: [],
    claims: [{ id: 'access', text: 'Access needs checking.', basis: 'unknown', evidence: [], limitations: 'No local availability evidence was supplied.' }],
  };
}
