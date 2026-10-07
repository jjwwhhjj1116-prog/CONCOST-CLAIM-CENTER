export function matchReferenceSources<T extends {
  fileId: string; extension: string; sizeBytes: number; sha256: string;
}>(sourceRoot: string, inventory: { totalFiles: number; files: T[] }): Array<T & { source: string }>;
export function assertQaOutputOutsideSources(sourceRoot: string, outputParent: string, outputName?: string): void;
export function readQaNativeEngine(candidateRoot?: string, expectedWasm?: string, expectedBinding?: string): {
  root: string; wasm: Uint8Array; engineSha256: string; bindingSha256: string;
};
