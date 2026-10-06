export function matchReferenceSources<T extends {
  fileId: string; extension: string; sizeBytes: number; sha256: string;
}>(sourceRoot: string, inventory: { totalFiles: number; files: T[] }): Array<T & { source: string }>;
