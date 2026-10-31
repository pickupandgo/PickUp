import { DriverOnboardingService } from '../src/services/onboarding/DriverOnboardingService';
jest.mock('../src/config/env', () => ({
  env: {
    PAYMENTS_API_BASE_URL: 'https://backend.example.test',
    REQUEST_TIMEOUT_MS: 5000,
  },
}));
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({
    currentUser: { getIdToken: async () => 'synthetic-token' },
  }),
}));

describe('Secure onboarding upload transport', () => {
  const originalFetch = globalThis.fetch,
    originalXHR = globalThis.XMLHttpRequest;
  let fetchMock: jest.Mock;
  let xhr: {
    open: jest.Mock;
    setRequestHeader: jest.Mock;
    send: jest.Mock;
    upload: { onprogress?: (event: object) => void };
    onload?: () => void;
    onerror?: () => void;
    status: number;
    timeout: number;
  };
  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    xhr = {
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      upload: {},
      status: 200,
      timeout: 0,
      send: jest.fn(() => {
        xhr.upload.onprogress?.({
          lengthComputable: true,
          loaded: 2,
          total: 4,
        });
        xhr.onload?.();
      }),
    };
    globalThis.XMLHttpRequest = jest.fn(
      () => xhr,
    ) as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXHR;
  });
  const fixture = () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: async () => ({ size: 4 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        document: { id: 'doc' },
        upload: {
          url: 'https://storage.example.test/private?signature=synthetic',
          headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
        },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'QUARANTINED' }),
    });
  };
  it('uses blob size and real progress and confirms only after the storage PUT', async () => {
    fixture();
    const progress = jest.fn();
    await DriverOnboardingService.getInstance().uploadKycDocument(
      'kyc',
      'TEST',
      { uri: 'file:///private/test.jpg', type: 'image/jpeg', fileSize: 999 },
      progress,
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      sizeBytes: 4,
      contentType: 'image/jpeg',
    });
    expect(progress).toHaveBeenCalledWith({ phase: 'UPLOADING', percent: 50 });
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'CONFIRMING',
      percent: null,
    });
    expect(fetchMock.mock.calls[2][0]).toContain('/documents/doc/complete');
    expect(
      xhr.setRequestHeader.mock.calls.some(
        ([key]) => key.toLowerCase() === 'authorization',
      ),
    ).toBe(false);
  });
  it('does not confirm when the storage connection fails', async () => {
    fixture();
    xhr.send.mockImplementation(() => xhr.onerror?.());
    await expect(
      DriverOnboardingService.getInstance().uploadKycDocument('kyc', 'TEST', {
        uri: 'file:///test.jpg',
        type: 'image/jpeg',
      }),
    ).rejects.toThrow('connection failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects unsupported files before requesting a presigned upload', async () => {
    await expect(
      DriverOnboardingService.getInstance().uploadKycDocument('kyc', 'TEST', {
        uri: 'file:///test.html',
        type: 'text/html',
      }),
    ).rejects.toThrow('JPEG or PNG');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
