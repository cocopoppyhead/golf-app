# How changes get into osolo

1. **Branch.** Every change starts on its own branch from `main`, named for what it does: `feat/r10-live`, `fix/putt-count`, `refactor/split-main`, `ci/...`, `docs/...`.
2. **Pull request.** Push the branch and open a pull request against `main`. The template asks how it was checked and whether it touches data.
3. **CI must pass.** Lint, unit tests, the build and the end-to-end tests run on every pull request. `main` is protected: nothing merges unless CI is green.
4. **Squash-merge.** One commit per change on `main`, titled like the pull request. The branch is deleted after the merge.
5. **Deploy follows CI.** After the merge, CI runs on `main`; only when it passes does the Deploy workflow publish that exact commit to GitHub Pages.
6. **Roll back** by reverting the pull request (the Revert button on the merged PR). That goes through CI and deploys like any other change.
7. **Releases.** Actions → Release → Run workflow, type the version (e.g. `0.2.0`). It tags `main` as `v0.2.0` and publishes a GitHub release listing the merged pull requests. Before 1.0, MINOR means new features and PATCH means fixes.

## Code layout

- `src/` is split by job: `coach/` (AI coach and analysis engine), `rounds/` (playing and reviewing rounds), `cloud/` (accounts and sync), `garmin/`, `r10/` (launch monitor), plus single-purpose modules (bag, laser, weather…).
- Pure logic (protocols, statistics, parsing) is kept apart from the UI, so it can be unit-tested and replaced alone.
- `src/datamap.js` and `docs/DATA.md` list everything the app stores.
- Personal data never goes in the repo. Use the git-ignored `private/` folder or synthetic fixtures.
