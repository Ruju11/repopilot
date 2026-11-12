import type { RepoSnapshot } from '../../src/core/types.ts';

export interface Sample {
  id: string;
  name: string;
  description: string;
  snapshot: RepoSnapshot;
}

const README = `# Sample project\n\n${'This synthetic project says what it does and how to run it. '.repeat(6)}`;
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.';

/** Synthetic data only. No real repository, person or secret appears here. */
export const SAMPLES: Sample[] = [
  {
    id: 'well-kept',
    name: 'Well-kept project',
    description: 'Every check passes.',
    snapshot: {
      origin: 'sample/well-kept',
      files: [
        'README.md',
        'LICENSE',
        'SECURITY.md',
        'CHANGELOG.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        '.gitignore',
        'package.json',
        'package-lock.json',
        '.github/workflows/ci.yml',
        '.github/dependabot.yml',
        '.github/CODEOWNERS',
        '.github/ISSUE_TEMPLATE/bug.md',
      ],
      contents: { 'README.md': README, LICENSE: MIT },
      notes: [],
    },
  },
  {
    id: 'bare',
    name: 'Bare repository',
    description: 'A very short README and little else.',
    snapshot: {
      origin: 'sample/bare',
      files: ['README.md', 'index.js', 'package.json'],
      contents: { 'README.md': '# Bare' },
      notes: [],
    },
  },
  {
    id: 'hostile',
    name: 'Hostile file names',
    description:
      'File names that try to inject HTML and links. A repository controls these names, so the demo shows them as plain text only.',
    snapshot: {
      origin: 'sample/hostile',
      files: [
        'README.md',
        '.github/workflows/<img src=x onerror=alert(1)>.yml',
        '.github/workflows/www.evil.example.yml',
        '.github/CODEOWNERS',
      ],
      contents: { 'README.md': '# Hi' },
      notes: ['Could not read https://evil.example/x (EIO).', '1 symbolic link(s) were not followed.'],
    },
  },
];
