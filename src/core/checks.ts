import type { Check, Finding, RepoSnapshot } from './types.ts';

function find(snapshot: RepoSnapshot, pattern: RegExp): string[] {
  return snapshot.files.filter((file) => pattern.test(file));
}

interface PresenceOptions {
  id: string;
  title: string;
  pattern: RegExp;
  searched: string[];
  whenMissing: 'warn' | 'fail';
  hint: string;
}

/** A check that passes when at least one file matches the pattern. */
function presence(options: PresenceOptions): Check {
  const { id, title, pattern, searched, whenMissing, hint } = options;
  return {
    id,
    title,
    run(snapshot): Finding {
      const evidence = find(snapshot, pattern);
      if (evidence.length > 0) {
        return { id, title, status: 'pass', message: `Found ${evidence[0]}.`, evidence, searched };
      }
      return { id, title, status: whenMissing, message: 'Not found.', evidence, searched, hint };
    },
  };
}

const README_MIN_CHARS = 200;

const readme: Check = {
  id: 'readme',
  title: 'README',
  run(snapshot): Finding {
    const base = { id: 'readme', title: 'README' };
    const searched = ['README*', '.github/README*', 'docs/README*'];
    const evidence = find(snapshot, /^(?:\.github\/|docs\/)?readme(?:\.[a-z]+)?$/i);
    const first = evidence[0];
    if (first === undefined) {
      return {
        ...base,
        status: 'fail',
        message: 'Not found.',
        evidence,
        searched,
        hint: 'Add a README.md that says what the project does and how to run it.',
      };
    }
    const text = snapshot.contents[first];
    if (text !== undefined && text.trim().length < README_MIN_CHARS) {
      return {
        ...base,
        status: 'warn',
        message: `${first} has ${text.trim().length} characters (under ${README_MIN_CHARS}).`,
        evidence,
        searched,
        hint: 'Describe the purpose, setup and usage.',
      };
    }
    return { ...base, status: 'pass', message: `Found ${first}.`, evidence, searched };
  },
};

/** Keyword patterns, most specific first. A match is a hint, not a legal determination. */
const LICENSE_PATTERNS: Array<[string, RegExp]> = [
  ['AGPL-3.0', /GNU AFFERO GENERAL PUBLIC LICENSE/i],
  ['LGPL', /GNU LESSER GENERAL PUBLIC LICENSE/i],
  ['GPL-3.0', /GNU GENERAL PUBLIC LICENSE\s+Version 3/i],
  ['GPL-2.0', /GNU GENERAL PUBLIC LICENSE\s+Version 2/i],
  ['Apache-2.0', /Apache License\s*,?\s*Version 2\.0/i],
  ['MPL-2.0', /Mozilla Public License,? Version 2\.0/i],
  ['MIT', /\bMIT License\b|Permission is hereby granted, free of charge/i],
  ['ISC', /\bISC License\b|Permission to use, copy, modify, and\/or distribute/i],
  ['BSD', /Redistribution and use in source and binary forms/i],
  ['Unlicense', /This is free and unencumbered software/i],
];

const license: Check = {
  id: 'license',
  title: 'Licence',
  run(snapshot): Finding {
    const base = { id: 'license', title: 'Licence' };
    const searched = ['LICENSE*', 'LICENCE*', 'COPYING*'];
    const evidence = find(snapshot, /^(?:licen[sc]e|copying)(?:[.-][a-z0-9.-]+)?$/i);
    const first = evidence[0];
    if (first === undefined) {
      return {
        ...base,
        status: 'fail',
        message: 'Not found. Without a licence, others have no permission to use the code.',
        evidence,
        searched,
        hint: 'Add a LICENSE file. See https://choosealicense.com/.',
      };
    }
    const text = snapshot.contents[first] ?? '';
    const match = LICENSE_PATTERNS.find(([, pattern]) => pattern.test(text));
    if (match === undefined) {
      return {
        ...base,
        status: 'warn',
        message: `Found ${first}, but its type was not recognised.`,
        evidence,
        searched,
        hint: 'Use the standard text of a known licence so tools and readers can identify it.',
      };
    }
    return {
      ...base,
      status: 'pass',
      message: `Found ${first}; looks like ${match[0]} (keyword match).`,
      evidence,
      searched,
    };
  },
};

interface Ecosystem {
  name: string;
  manifest: RegExp;
  lock: RegExp;
}

const ECOSYSTEMS: Ecosystem[] = [
  {
    name: 'npm',
    manifest: /^package\.json$/,
    lock: /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  },
  { name: 'Python', manifest: /^(?:pyproject\.toml|Pipfile)$/, lock: /^(?:poetry\.lock|uv\.lock|Pipfile\.lock|pdm\.lock)$/ },
  { name: 'Rust', manifest: /^Cargo\.toml$/, lock: /^Cargo\.lock$/ },
  { name: 'Go', manifest: /^go\.mod$/, lock: /^go\.sum$/ },
  { name: 'Ruby', manifest: /^Gemfile$/, lock: /^Gemfile\.lock$/ },
  { name: 'PHP', manifest: /^composer\.json$/, lock: /^composer\.lock$/ },
];

const lockfile: Check = {
  id: 'lockfile',
  title: 'Dependency lockfile',
  run(snapshot): Finding {
    const base = { id: 'lockfile', title: 'Dependency lockfile' };
    const searched = ['root-level manifests and their lockfiles'];
    const present = ECOSYSTEMS.filter((eco) => find(snapshot, eco.manifest).length > 0);
    if (present.length === 0) {
      return {
        ...base,
        status: 'not-applicable',
        message: 'No supported dependency manifest at the repository root.',
        evidence: [],
        searched,
      };
    }
    const evidence = present.flatMap((eco) => find(snapshot, eco.lock));
    const missing = present.filter((eco) => find(snapshot, eco.lock).length === 0);
    if (missing.length > 0) {
      return {
        ...base,
        status: 'warn',
        message: `No lockfile for: ${missing.map((eco) => eco.name).join(', ')}.`,
        evidence,
        searched,
        hint: 'Commit a lockfile so builds are reproducible. Libraries sometimes omit one on purpose.',
      };
    }
    return { ...base, status: 'pass', message: `Found ${evidence.join(', ')}.`, evidence, searched };
  },
};

export const checks: Check[] = [
  readme,
  license,
  presence({
    id: 'security-policy',
    title: 'Security policy',
    pattern: /^(?:\.github\/|docs\/)?security\.md$/i,
    searched: ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md'],
    whenMissing: 'fail',
    hint: 'Add SECURITY.md explaining how to report a vulnerability privately.',
  }),
  presence({
    id: 'ci',
    title: 'Continuous integration',
    pattern: /^(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|\.circleci\/config\.yml|azure-pipelines\.yml)$/i,
    searched: ['.github/workflows/*.yml', '.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml'],
    whenMissing: 'fail',
    hint: 'Add a CI workflow that runs the tests on every push and pull request.',
  }),
  presence({
    id: 'gitignore',
    title: '.gitignore',
    pattern: /^\.gitignore$/,
    searched: ['.gitignore'],
    whenMissing: 'warn',
    hint: 'Add a .gitignore so build output and local secrets such as .env are not committed.',
  }),
  lockfile,
  presence({
    id: 'changelog',
    title: 'Changelog',
    pattern: /^(?:changelog|changes|history|releases)(?:\.[a-z]+)?$/i,
    searched: ['CHANGELOG*', 'CHANGES*', 'HISTORY*', 'RELEASES*'],
    whenMissing: 'warn',
    hint: 'Add CHANGELOG.md listing user-visible changes per version.',
  }),
  presence({
    id: 'contributing',
    title: 'Contributing guide',
    pattern: /^(?:\.github\/|docs\/)?contributing(?:\.[a-z]+)?$/i,
    searched: ['CONTRIBUTING*', '.github/CONTRIBUTING*', 'docs/CONTRIBUTING*'],
    whenMissing: 'warn',
    hint: 'Add CONTRIBUTING.md describing how to propose changes and run the tests.',
  }),
  presence({
    id: 'code-of-conduct',
    title: 'Code of conduct',
    pattern: /^(?:\.github\/|docs\/)?code_of_conduct(?:\.[a-z]+)?$/i,
    searched: ['CODE_OF_CONDUCT*', '.github/CODE_OF_CONDUCT*', 'docs/CODE_OF_CONDUCT*'],
    whenMissing: 'warn',
    hint: 'Add CODE_OF_CONDUCT.md if you accept outside contributions.',
  }),
  presence({
    id: 'dependency-updates',
    title: 'Automated dependency updates',
    pattern: /^(?:\.github\/dependabot\.ya?ml|(?:\.github\/)?renovate\.json5?|\.renovaterc(?:\.json)?)$/i,
    searched: ['.github/dependabot.yml', 'renovate.json', '.github/renovate.json', '.renovaterc'],
    whenMissing: 'warn',
    hint: 'Add .github/dependabot.yml so dependency updates arrive as pull requests.',
  }),
  presence({
    id: 'templates',
    title: 'Issue or pull request templates',
    pattern: /^(?:\.github\/|docs\/)?(?:issue_template\/[^/]+|issue_template\.md|pull_request_template\.md|pull_request_template\/[^/]+)$/i,
    searched: ['.github/ISSUE_TEMPLATE/', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/', 'repository root'],
    whenMissing: 'warn',
    hint: 'Add templates under .github/ so reports and pull requests arrive with the needed details.',
  }),
  presence({
    id: 'codeowners',
    title: 'CODEOWNERS',
    pattern: /^(?:\.github\/|docs\/)?CODEOWNERS$/,
    searched: ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'],
    whenMissing: 'warn',
    hint: 'Add CODEOWNERS so reviews are requested from the right people.',
  }),
];
