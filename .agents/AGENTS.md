<!-- @import /home/lab/.claude/CLAUDE.md -->
<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file imports the user-level configuration from `/home/lab/.claude/CLAUDE.md` and the workspace-level configuration from `/home/lab/workspace/.claude/CLAUDE.md`. Both layers apply. The rules below strengthen or extend them.

The workspace path was absent when this file was written. The import resolves to nothing until that file exists. The user-level layer applies in full.

## Project Context

`jupyterlab_core_patches_extension` is one JupyterLab 4 extension carrying ten Stellars core patches. It is the direct replacement for the `stellars_jupyterlab_fixes` metapackage and for the ten discrete core-patch extensions that metapackage installs. The ten old packages stay published and frozen; uninstall the bundle and the ten packages before installing this one, because two installed copies apply every patch twice.

- **One entry, eleven plugins** - one labextension entry, one settings schema, ten patch plugins plus one main plugin
- **One switch per patch** - each patch has one boolean in the shared schema, default `true`
- **Plugin ids** - each patch plugin id is `@stellarshenson/jupyterlab-core-patches-extension:<slug>`, so a disable of the package reaches it; the old package name stays as the switch key
- **Scope** - `INTENT.md` is the authority for what the extension must do; port the patch logic unchanged
- **Stack** - TypeScript frontend, Python packaging, Jest, pytest, Playwright/Galata
- **Sources** - the ten source projects sit beside this one under `/home/lab/workspace/private/jupyterlab/`

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Build Lifecycle

The Makefile owns the whole build lifecycle. Never run `pip`, `jlpm`, `yarn`, `npm`, build, publish or clean commands directly.

- **Build and install** - `make install`
- **Release** - `make publish`
- **Clean build artefacts** - `make clean`
- **Remove every build and venv artefact** - `make mrproper`
- **Lockfiles** - `package.json`, `package-lock.json` and `yarn.lock` are always committed together
- **Makefile version** - check the local version against `/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile`; update the local Makefile as soon as the reference is newer
- **Repository** - the project root is its own git repository on `main`; the initial import carries every artefact; never commit this project's files into the workspace superproject
- **Never run `make publish`** without explicit approval in that turn

`make install` raises the patch version by design. Treat that as part of the build, not as a release.

## Acceptance Criteria and Defects

Trackers live in `docs/acc-crit*.md` and `docs/defects*.md`. Every read and write goes through the project-management plugin and the `pm-tools` CLI. A hand edit of either file is forbidden.

- **Add or relate a criterion** - `/project-management:acc-crit`
- **File, triage, log or close a defect** - `/project-management:defect`
- **Status and coverage** - `/project-management:report`
- **Before the code** - every feature gets its acceptance criteria before its implementation
- **Named test** - every criterion names the test that proves it in its `test:` hint
- **Functional tests** - a feature under `ui-tests/` is part of the feature, not an afterthought; the suite runs green before a release

## Agent Skill for a Shipped CLI

If the extension ships a command-line tool, the entry point under `[project.scripts]` in `pyproject.toml` gets the `--help` text and the agent skill that the `jupyterlab-extension` skill's section "Agent Skill for a Shipped CLI" prescribes.

- **Name** - the extension name in kebab-case
- **Location** - `.agents/skills/<name>/SKILL.md` at the repository root
- **Wheel** - the same skill ships through `[tool.hatch.build.targets.wheel.shared-data]`
- **Same commit** - the skill and the `--help` text change in the commit that changes the CLI
- **Reference** - `/home/lab/workspace/private/jupyterlab/jupyterlab_notifications_extension`

This extension currently ships no CLI.

## Scope Control

The `graphify` skill bounds every change.

- **Build the graph** - run `/graphify` once the first source is in place; the output lands in `tmp/graphify-out/`
- **Before editing** - run `graphify affected` to learn the callers and dependents
- **Change budget** - treat the affected set as the budget; an edit outside it needs the Star Colonel's word
- **After every edit** - run `graphify update`
- **Never ships** - `tmp/` is gitignored

## Documentation

- **README is the tally** - it lists all ten patches with one line each and links every page
- **One page per fix** - `docs/<slug>.md` states the switch, the plugin id, the patched member, the guard, the source file and the tests
- **Every member documented** - every exported symbol carries TSDoc, and the page's member table names each one
- **Style** - use the `markdown-editing` skill's technical documentation style, modus secundis

## Required Skills

| Skill                                            | Use                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `jupyterlab-extension`                           | extension development guidelines, testing strategy, CI/CD, caveats                    |
| `my-browser`                                     | browser automation for screenshots and UI verification against the running JupyterLab |
| `project-management:project-management` (plugin) | acceptance criteria and defects through the pm-tools CLI                              |
| `graphify`                                       | the codebase graph and the impact analysis that bounds every change                   |
| `journal:journal` (plugin)                       | the project journal through the journal-tools CLI                                     |

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the canonical tool for this file: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Direct edits to `JOURNAL.md` are a last resort - prefer the plugin so modus secundis format, continuous numbering and append-only order are enforced automatically

## Acceptance Criteria, Defects and Edge Cases (Project-Specific)

- **Record before working** - when the user states a new acceptance criterion or a new defect, or a change to one, record it through `/project-management:project-management` in the same turn, before working on it
- **Trackers through `pm-tools` only** - every write to `docs/acc-crit*.md` and `docs/defects*.md` goes through `pm-tools`, never a hand edit
- **Real edge cases** - handle the edge cases a real user or a real input reaches; the ones that are cheap to resolve are handled together, in the smallest change, without debating each one
- **No extreme edge cases** - do not chase extreme or contrived edge cases in code, tests or reviews; each one costs tokens and review rounds and changes nothing a user gets
