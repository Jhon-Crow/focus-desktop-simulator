# Release Guide / Руководство по созданию релизов

This document describes how to create releases for Focus Desktop Simulator.

Этот документ описывает, как создавать релизы для Focus Desktop Simulator.

## Quick Start / Быстрый старт

### Option 1: Manual Release Workflow (Recommended)

The easiest way to create a release is using the manual release workflow:

1. Go to [Actions → Release](https://github.com/Jhon-Crow/focus-desktop-simulator/actions/workflows/release.yml)
2. Click "Run workflow"
3. Enter the version number (e.g., `1.0.0`)
4. Optionally mark as pre-release
5. Click "Run workflow"

The workflow will:
- Update `package.json` and `package-lock.json` with the new version
- Commit and push the version bump
- Create and push a git tag (e.g., `v1.0.0`)
- Trigger the build workflow automatically
- Create a GitHub release with auto-generated release notes
- Attach the built executables to the release

### Option 2: Manual Tag Push

You can also create a release by manually pushing a tag:

```bash
# Update version in package.json
npm version 1.0.0 --no-git-tag-version

# Commit the version bump
git add package.json package-lock.json
git commit -m "chore: bump version to 1.0.0"
git push

# Create and push the tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

This will trigger the build workflow, which will automatically create a GitHub release.

## Versioning / Версионирование

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version when you make incompatible API changes
- **MINOR** version when you add functionality in a backward compatible manner
- **PATCH** version when you make backward compatible bug fixes

Examples:
- `1.0.0` - First stable release
- `1.1.0` - Added new features (new objects, new UI)
- `1.0.1` - Bug fixes only
- `2.0.0` - Breaking changes (complete UI redesign, removed features)

## Release Workflow Details / Детали процесса релиза

### Build Workflow (`.github/workflows/build.yml`)

This workflow runs on:
- Push to `main` branch (builds but doesn't release)
- Push to tags starting with `v` (builds and creates release)
- Pull requests to `main` (builds but doesn't release)
- Manual trigger

Jobs:
1. **build** - Builds Windows executables (NSIS installer and portable)
2. **release** - Creates GitHub release with executables (only for tags)

### Release Workflow (`.github/workflows/release.yml`)

This is a manual workflow that helps automate the entire release process:

1. Validates version format
2. Checks if tag already exists
3. Updates package.json version
4. Commits and pushes version bump
5. Creates and pushes git tag
6. Waits for build workflow to complete
7. Updates release with generated release notes

## Release Checklist / Чеклист релиза

Before creating a release:

- [ ] All tests are passing
- [ ] All features are documented in README.md
- [ ] CHANGELOG is updated (if you maintain one)
- [ ] Version number follows SemVer
- [ ] All changes are committed and pushed to main
- [ ] Build workflow runs successfully on main

## Troubleshooting / Устранение проблем

### Release workflow failed

Check the Actions tab for error messages. Common issues:
- Tag already exists - delete the tag and try again
- Build workflow failed - check build logs
- Permissions issue - ensure GitHub token has write access

### Executables not attached to release

The build workflow might have failed. Check:
1. Build workflow logs in Actions tab
2. Ensure electron-builder is properly configured
3. Verify artifact upload steps completed successfully

### Release notes not generated

The release workflow generates notes automatically from git commits. If empty:
1. Check if there are commits since the last tag
2. Ensure git history is available (fetch-depth: 0)

## Manual Release Creation / Ручное создание релиза

If you need to create a release manually:

```bash
# Build executables locally
npm run build

# Create a release on GitHub
gh release create v1.0.0 \
  --title "Focus Desktop Simulator v1.0.0" \
  --notes "Release notes here" \
  dist/*Setup*.exe \
  dist/*portable*.exe
```

## Resources / Ресурсы

- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Semantic Versioning](https://semver.org/)
- [electron-builder Publishing](https://www.electron.build/configuration/publish)
