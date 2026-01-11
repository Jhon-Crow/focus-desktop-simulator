// Mock Electron modules for testing

const mockBrowserWindow = {
  loadFile: jest.fn(),
  webContents: {
    send: jest.fn(),
    openDevTools: jest.fn()
  },
  on: jest.fn(),
  setFullScreen: jest.fn(),
  setMenuBarVisibility: jest.fn(),
  isFullScreen: jest.fn(() => false),
  show: jest.fn(),
  hide: jest.fn(),
  close: jest.fn(),
  destroy: jest.fn(),
  focus: jest.fn(),
  blur: jest.fn()
};

const app = {
  getPath: jest.fn((name) => {
    const paths = {
      userData: '/tmp/test-user-data',
      documents: '/tmp/test-documents',
      home: '/tmp/test-home'
    };
    return paths[name] || '/tmp/test-path';
  }),
  quit: jest.fn(),
  on: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve()),
  isReady: jest.fn(() => true),
  getName: jest.fn(() => 'focus-desktop-simulator'),
  getVersion: jest.fn(() => '1.0.0')
};

const BrowserWindow = jest.fn(() => mockBrowserWindow);
BrowserWindow.getAllWindows = jest.fn(() => [mockBrowserWindow]);
BrowserWindow.getFocusedWindow = jest.fn(() => mockBrowserWindow);

const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn()
};

const ipcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  send: jest.fn(),
  removeListener: jest.fn()
};

const contextBridge = {
  exposeInMainWorld: jest.fn()
};

const dialog = {
  showOpenDialog: jest.fn(() => Promise.resolve({ canceled: false, filePaths: ['/tmp/test-file'] })),
  showSaveDialog: jest.fn(() => Promise.resolve({ canceled: false, filePath: '/tmp/test-save' })),
  showMessageBox: jest.fn(() => Promise.resolve({ response: 0 }))
};

const shell = {
  openPath: jest.fn(() => Promise.resolve('')),
  openExternal: jest.fn(() => Promise.resolve())
};

const nativeTheme = {
  themeSource: 'system',
  shouldUseDarkColors: true
};

module.exports = {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  contextBridge,
  dialog,
  shell,
  nativeTheme,
  mockBrowserWindow
};
