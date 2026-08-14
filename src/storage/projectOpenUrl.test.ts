import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  projectFileUrlFromOpenPath,
  rewriteIncomingProjectPath,
} from './projectOpenUrl';

describe('projectFileUrlFromOpenPath', () => {
  it('accepts file URLs with a .vmp name', () => {
    const url = 'file:///var/mobile/Containers/Data/Inbox/Session%20A.vmp';
    assert.equal(projectFileUrlFromOpenPath(url), url);
  });

  it('accepts bare sandbox paths', () => {
    assert.equal(
      projectFileUrlFromOpenPath('/tmp/Inbox/demo.vmp'),
      'file:///tmp/Inbox/demo.vmp'
    );
  });

  it('rejects other extensions', () => {
    assert.equal(projectFileUrlFromOpenPath('file:///tmp/clip.m4a'), null);
    assert.equal(projectFileUrlFromOpenPath('/tmp/notes.txt'), null);
  });
});

describe('rewriteIncomingProjectPath', () => {
  it('rewrites .vmp file URLs to the import route', () => {
    const url = 'file:///tmp/Inbox/Session%20A.vmp';
    assert.equal(
      rewriteIncomingProjectPath(url),
      `/import-project?uri=${encodeURIComponent(url)}`
    );
  });

  it('leaves app deep links unchanged', () => {
    const path = 'voicememosplus://memo/abc';
    assert.equal(rewriteIncomingProjectPath(path), path);
  });

  it('does not double-rewrite the import route', () => {
    const path = '/import-project?uri=file%3A%2F%2F%2Ftmp%2Fa.vmp';
    assert.equal(rewriteIncomingProjectPath(path), path);
  });
});
