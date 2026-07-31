import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideAutoRecord } from './autoRecordGate';

describe('decideAutoRecord', () => {
  it('starts a fresh empty memo with process intent', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: true,
        isRecording: false,
        hasRecording: false,
        hasProcessIntent: true,
        sessionMemoId: null,
        memoId: 'm1',
      }),
      'start'
    );
  });

  it('skips restored record=1 without process intent', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: true,
        isRecording: false,
        hasRecording: false,
        hasProcessIntent: false,
        sessionMemoId: null,
        memoId: 'm1',
      }),
      'skipNoProcessIntent'
    );
  });

  it('skips when the memo already has audio', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: true,
        isRecording: false,
        hasRecording: true,
        hasProcessIntent: true,
        sessionMemoId: null,
        memoId: 'm1',
      }),
      'skipHasAudio'
    );
  });

  it('skips when another memo owns the live session', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: true,
        isRecording: false,
        hasRecording: false,
        hasProcessIntent: true,
        sessionMemoId: 'other',
        memoId: 'm1',
      }),
      'skipOtherMemoSession'
    );
  });

  it('skips when the memo was discarded or is missing', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: true,
        isRecording: false,
        hasRecording: false,
        hasProcessIntent: true,
        sessionMemoId: null,
        memoId: 'm1',
        memoMissing: true,
      }),
      'skipDeletedMemo'
    );
  });

  it('skips when not requested', () => {
    assert.equal(
      decideAutoRecord({
        autoRecord: false,
        isRecording: false,
        hasRecording: false,
        hasProcessIntent: true,
        sessionMemoId: null,
        memoId: 'm1',
      }),
      'skipNotRequested'
    );
  });
});
