export function matchReferenceSources<T extends {
  fileId: string; extension: string; sizeBytes: number; sha256: string;
}>(sourceRoot: string, inventory: { totalFiles: number; files: T[] }): Array<T & { source: string }>;
export function assertQaOutputOutsideSources(sourceRoot: string, outputParent: string, outputName?: string): void;
export function readQaNativeEngine(candidateRoot?: string, expectedWasm?: string, expectedBinding?: string): {
  root: string; wasm: Uint8Array; engineSha256: string; bindingSha256: string;
};
type QaNativeExportResult={contentLoss():string;takeBytes():Uint8Array;free():void};
export function exportNativeWithReport(document:{exportHwpWithReport():QaNativeExportResult;exportHwpxWithReport():QaNativeExportResult},format:'hwp'|'hwpx'):{bytes:Uint8Array;report:{schemaVersion:number;outputFormat:'hwp'|'hwpx';count:number;lossRecords:number}};
