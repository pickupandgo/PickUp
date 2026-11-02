import type { User } from '@react-native-firebase/auth';
import { FirebaseAuthService } from '../src/services/auth/AuthService';

const mockSession: { currentUser: User | null } = { currentUser: null };
const mockSetToken = jest.fn();
const mockStop = jest.fn();
let mockEvent: (user: User | null) => Promise<void>;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => mockSession,
  onAuthStateChanged: (_auth: unknown, event: typeof mockEvent) => {
    mockEvent = event;
    return mockStop;
  },
}));
jest.mock('../src/services/api/ApiClient', () => ({
  ApiClient: { getInstance: () => ({ setToken: mockSetToken }) },
}));
jest.mock('../src/services/notifications/notifications', () => ({
  pushSession: {},
}));
jest.mock('../src/config/env', () => ({
  env: { PAYMENTS_API_BASE_URL: 'https://backend.example' },
}));

describe('Firebase session restoration never reuses an obsolete identity', () => {
  let service: FirebaseAuthService;
  let listener: jest.Mock;
  let stop: () => void;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.currentUser = null;
    service = new FirebaseAuthService();
    listener = jest.fn();
    stop = service.observeAuthState(listener);
  });
  afterEach(() => {
    stop();
  });
  const pendingUser = () => {
    let resolve!: (token: string) => void;
    const token = new Promise<string>(yes => {
      resolve = yes;
    });
    return {
      user: { uid: 'fixture-driver', getIdToken: () => token } as User,
      resolve,
    };
  };
  it('sets the current signed-in identity token and notifies its subscriber', async () => {
    const { user, resolve } = pendingUser();
    mockSession.currentUser = user;
    const pending = mockEvent(user);
    resolve('synthetic-current-token');
    await pending;
    expect(mockSetToken).toHaveBeenCalledWith('synthetic-current-token');
    expect(listener).toHaveBeenCalledWith(user);
  });
  it('cannot restore a token that finishes after signout', async () => {
    const { user, resolve } = pendingUser();
    mockSession.currentUser = user;
    const pending = mockEvent(user);
    mockSession.currentUser = null;
    await mockEvent(null);
    resolve('synthetic-obsolete-token');
    await pending;
    expect(mockSetToken.mock.calls).toEqual([[null]]);
    expect(listener.mock.calls).toEqual([[null]]);
  });
  it('retains the newer identity when old token restoration finishes late', async () => {
    const { user, resolve } = pendingUser();
    mockSession.currentUser = user;
    const pending = mockEvent(user);
    const next = {
      uid: 'second-fixture-driver',
      getIdToken: async () => 'synthetic-new-token',
    } as User;
    mockSession.currentUser = next;
    await mockEvent(next);
    resolve('synthetic-obsolete-token');
    await pending;
    expect(mockSetToken.mock.calls).toEqual([['synthetic-new-token']]);
    expect(listener.mock.calls).toEqual([[next]]);
  });
  it('does not update token cache or call a subscriber after unsubscribe', async () => {
    const { user, resolve } = pendingUser();
    mockSession.currentUser = user;
    const pending = mockEvent(user);
    stop();
    resolve('synthetic-obsolete-token');
    await pending;
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
  it('does not start backend bootstrap with a token for a session that has changed', async () => {
    const { user, resolve } = pendingUser();
    mockSession.currentUser = user;
    const pending = service.bootstrapDriver();
    const asserted = expect(pending).rejects.toThrow(
      'Your sign-in session changed',
    );
    mockSession.currentUser = null;
    resolve('synthetic-obsolete-token');
    await asserted;
    expect(mockSetToken).not.toHaveBeenCalled();
  });
});
