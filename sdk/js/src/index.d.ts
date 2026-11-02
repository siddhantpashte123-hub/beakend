export interface BluebeakendConfig {
  apiKey: string;
  authDomain?: string;
  baseUrl?: string;
  projectId?: string;
  storageBucket?: string;
  realtimeUrl?: string;
  secure?: boolean;
  accessToken?: string;
  refreshToken?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  emailVerified: boolean;
  provider: string;
  metadata: Record<string, unknown>;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type WhereOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains' | 'exists';

export type Document<T = Record<string, any>> = T & {
  id: string;
  _id: string;
  _createdAt: string;
  _updatedAt: string;
};

export interface QuerySnapshot<T = Record<string, any>> extends Iterable<Document<T>> {
  docs: Document<T>[];
  total: number;
  size: number;
  empty: boolean;
  forEach(cb: (doc: Document<T>, index: number) => void): void;
  map<U>(cb: (doc: Document<T>, index: number) => U): U[];
}

export interface StorageFile {
  id: string;
  fileId: string;
  name: string;
  folder: string;
  mime: string;
  size: number;
  isPublic: boolean;
  createdAt: string;
  url: string;
}

export interface SnapshotChange<T = Record<string, any>> {
  type: string;
  collection?: string;
  doc: Document<T> | null;
  id: string | null;
  ts?: string;
}

export declare class Query<T = Record<string, any>> {
  where(field: string, op: WhereOp, value: unknown): Query<T>;
  orderBy(field: string, direction?: 'asc' | 'desc'): Query<T>;
  limit(n: number): Query<T>;
  offset(n: number): Query<T>;
  select(...fields: string[]): Query<T>;
  get(): Promise<QuerySnapshot<T>>;
  count(): Promise<number>;
}

export declare class DocumentRef<T = Record<string, any>> {
  readonly id: string;
  get(): Promise<Document<T>>;
  update(patch: Partial<T>): Promise<Document<T>>;
  set(data: T): Promise<Document<T>>;
  delete(): Promise<{ ok: boolean; id: string }>;
  onSnapshot(callback: (change: SnapshotChange<T>) => void): () => void;
}

export declare class CollectionRef<T = Record<string, any>> extends Query<T> {
  add(data: T): Promise<Document<T>>;
  doc(id: string): DocumentRef<T>;
  batch(ops: Array<{ op: 'create' | 'update' | 'replace' | 'delete'; id?: string; data?: Partial<T> }>): Promise<{ results: unknown[] }>;
  onSnapshot(callback: (change: SnapshotChange<T>) => void, opts?: { includeInitial?: boolean }): () => void;
}

export declare class Bluebeakend {
  readonly apiKey: string;
  readonly projectId: string;
  readonly baseUrl: string;
  readonly realtimeUrl: string;

  readonly auth: {
    currentUser: User | null;
    signup(email: string, password: string, name?: string): Promise<AuthResponse>;
    register(email: string, password: string, name?: string): Promise<AuthResponse>;
    login(email: string, password: string): Promise<AuthResponse>;
    logout(): Promise<{ ok: boolean }>;
    refresh(): Promise<AuthResponse>;
    me(): Promise<User>;
    updateProfile(patch: { name?: string; password?: string; metadata?: Record<string, unknown> }): Promise<User>;
    forgotPassword(email: string): Promise<{ ok: boolean; message: string }>;
    resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; message: string }>;
    verifyEmail(token: string): Promise<{ ok: boolean; message: string }>;
    sessions(): Promise<Array<{ id: string; userAgent: string; ip: string; createdAt: string; expiresAt: string }>>;
    revokeSession(id: string): Promise<{ ok: boolean }>;
    onAuthStateChanged(listener: (user: User | null) => void): () => void;
  };

  readonly db: {
    collection<T = Record<string, any>>(name: string): CollectionRef<T>;
    collections(): Promise<Array<{ name: string; count: number }>>;
  };

  readonly storage: {
    upload(file: Blob | Uint8Array | string | { buffer: Uint8Array; name?: string; mime?: string }, opts?: { name?: string; folder?: string; mime?: string; isPublic?: boolean }): Promise<StorageFile>;
    getUrl(fileId: string): Promise<string>;
    getMetadata(fileId: string): Promise<StorageFile>;
    list(opts?: { folder?: string; limit?: number; offset?: number }): Promise<{ files: StorageFile[]; total: number }>;
    delete(fileId: string): Promise<{ ok: boolean; id: string }>;
    createSignedUploadUrl(opts: { name: string; folder?: string; mime?: string; size?: number }): Promise<{ fileId: string; uploadUrl: string; method: string; headers: Record<string, string> }>;
  };

  readonly realtime: {
    connect(): Promise<WebSocket>;
    subscribe(channel: string, callback: (frame: any) => void): () => void;
    publish(channel: string, eventName: string, payload?: unknown): Promise<void>;
    disconnect(): void;
  };

  constructor(config: BluebeakendConfig);
}

export declare const BlueBeakend: typeof Bluebeakend;
export default Bluebeakend;
