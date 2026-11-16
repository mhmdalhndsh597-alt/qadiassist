#!/usr/bin/env bash
set -euo pipefail

remote="${MEYAR_UPSTREAM_REMOTE:-upstream}"
branch="${MEYAR_UPSTREAM_BRANCH:-main}"
mode="${1:-preview}"

if [[ "$mode" != "preview" && "$mode" != "--merge" ]]; then
  echo "Usage: $0 [--merge]" >&2
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script inside the private repository working copy." >&2
  exit 2
fi
if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "Remote '$remote' is not configured. Add the public source repository as '$remote' first." >&2
  exit 2
fi
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$branch" ]]; then
  echo "Switch to '$branch' before syncing (current: '${current_branch:-detached}')." >&2
  exit 2
fi

git fetch --prune "$remote" "$branch"
if ! git merge-base HEAD "$remote/$branch" >/dev/null 2>&1; then
  echo "The private and public histories do not share a base; refusing an automatic merge." >&2
  exit 1
fi

printf '\nIncoming commits from %s/%s:\n' "$remote" "$branch"
git log --oneline --decorate --no-merges "HEAD..$remote/$branch" || true
if [[ "$mode" == "--merge" ]]; then
  git merge --no-edit --no-ff "$remote/$branch"
  printf '\nMerge completed. Review changes and tests before pushing to origin/%s.\n' "$branch"
else
  printf '\nPreview only: inspect the changes above. Re-run with --merge to merge; resolve conflicts manually.\n'
fi
