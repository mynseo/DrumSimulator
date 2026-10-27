import type { Instrument } from '../core/types';

/**
 * "내 샘플" 파일을 브라우저(IndexedDB)에 저장해서 다음에 열어도 남아 있게 한다.
 * 저장이 막힌 환경(사생활 보호 모드 등)에서는 조용히 실패하고, 이번 방문 동안만 쓴다.
 */
const DB = 'drumsim';
const STORE = 'samples';

export interface StoredSample {
  instrument: Instrument;
  name: string;
  data: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'instrument' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSample(s: StoredSample): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(s));
  } catch {
    /* 저장 불가 환경 */
  }
}

export async function deleteSample(instrument: Instrument): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(instrument));
  } catch {
    /* 저장 불가 환경 */
  }
}

export async function loadSamples(): Promise<StoredSample[]> {
  try {
    return await run('readonly', (store) => store.getAll() as IDBRequest<StoredSample[]>);
  } catch {
    return [];
  }
}
