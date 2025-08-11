export interface ContentViewer { render(bytes: Uint8Array, mime: string): Promise<string>; }
export interface ContentDiff { diff(a: Uint8Array, b: Uint8Array, mime: string): Promise<string>; }
export interface ContentMerge {
  merge(base: Uint8Array, ours: Uint8Array, theirs: Uint8Array, mime: string): Promise<{ bytes: Uint8Array, conflicts: any[] }>;
}

// v0 stubs
export const TextViewer: ContentViewer = {
  async render(bytes, mime) { return new TextDecoder().decode(bytes); }
};
