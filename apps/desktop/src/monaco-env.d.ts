declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: () => Worker;
    };
  }
}

export {};
