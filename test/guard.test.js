const test = require('node:test');
const assert = require('node:assert');
const guard = require('../lib/guard');

test('разрешённые git-команды проходят', () => {
  for (const c of ['git status', 'git fetch --all --prune', 'git checkout feature/x', 'git pull --ff-only', 'git stash push -u', 'git log --oneline -n 3', 'cd x && git branch --list']) {
    assert.doesNotThrow(() => guard.check(c), c);
  }
});

test('опасные git-команды и gh/glab запрещены', () => {
  for (const c of ['git push', 'git commit -m x', 'git merge dev', 'git rebase main', 'git reset --hard', 'git clean -fd', 'git checkout -- .', 'git branch -D x', 'git stash clear', 'git pull', 'gh pr list', 'glab mr list', 'ls; git push -f']) {
    assert.throws(() => guard.check(c), undefined, c);
  }
});
