import React, { createContext, useCallback, useContext, useState } from 'react';

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

interface UploadState {
  status: UploadStatus;
  /** 0–1 */
  progress: number;
  label: string;
  error?: string;
}

interface UploadProgressContextValue {
  upload: UploadState;
  startUpload: (label: string) => void;
  setUploadProgress: (progress: number) => void;
  finishUpload: () => void;
  failUpload: (error?: string) => void;
  dismissUpload: () => void;
}

const IDLE: UploadState = { status: 'idle', progress: 0, label: '' };

const UploadProgressContext = createContext<UploadProgressContextValue>({
  upload: IDLE,
  startUpload: () => {},
  setUploadProgress: () => {},
  finishUpload: () => {},
  failUpload: () => {},
  dismissUpload: () => {},
});

export function UploadProgressProvider({ children }: { children: React.ReactNode }) {
  const [upload, setUpload] = useState<UploadState>(IDLE);

  const startUpload = useCallback((label: string) => {
    setUpload({ status: 'uploading', progress: 0, label });
  }, []);

  const setUploadProgress = useCallback((progress: number) => {
    setUpload((prev) =>
      prev.status === 'uploading' ? { ...prev, progress: Math.min(progress, 0.99) } : prev,
    );
  }, []);

  const finishUpload = useCallback(() => {
    setUpload((prev) => ({ ...prev, status: 'done', progress: 1 }));
    // Auto-dismiss after 3 s
    setTimeout(() => setUpload(IDLE), 3000);
  }, []);

  const failUpload = useCallback((error?: string) => {
    setUpload((prev) => ({ ...prev, status: 'error', error: error ?? 'Upload failed' }));
    // Auto-dismiss after 5 s
    setTimeout(() => setUpload(IDLE), 5000);
  }, []);

  const dismissUpload = useCallback(() => setUpload(IDLE), []);

  return (
    <UploadProgressContext.Provider
      value={{ upload, startUpload, setUploadProgress, finishUpload, failUpload, dismissUpload }}
    >
      {children}
    </UploadProgressContext.Provider>
  );
}

export function useUploadProgress() {
  return useContext(UploadProgressContext);
}
