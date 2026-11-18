import { isAbsolute } from 'node:path';

export function validateProjectPath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || isAbsolute(value) || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Error('Use a project-relative path with forward slashes and ordinary folder names. Traversal, Git metadata and special paths are excluded.');
  return value;
}
