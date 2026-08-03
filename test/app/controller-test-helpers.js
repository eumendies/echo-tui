const {AppContext} = require('../../src/app/state/app-context');

function createAppContext(cwd = '/tmp/echo_tui') {
  return new AppContext(
    {getSize() { return {columns: 80, rows: 24}; }},
    createTranscriptStore(),
    cwd,
    'v20.0.0',
    undefined,
    undefined,
    createSessionModelSettingsStore()
  );
}

function createTranscriptStore() {
  return {
    createSession(cwd) {
      return {sessionId: 'session-1', cwd, createdAt: '', updatedAt: '', sequence: 1};
    },
    appendSession(_cwd, reference) {
      return {...reference, sequence: reference.sequence + 1};
    },
    listSessions() {
      return [];
    },
    loadSession() {
      return null;
    },
    loadSessionReadOnly() {
      return null;
    }
  };
}

function createSessionModelSettingsStore() {
  return {
    getFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.settings.json`;
    },
    read() {
      return {kind: 'missing'};
    },
    write(_cwd, input) {
      return {schemaVersion: 1, sessionId: input.sessionId, modelProfileId: input.modelProfileId, updatedAt: ''};
    }
  };
}

module.exports = {createAppContext};
