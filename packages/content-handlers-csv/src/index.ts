export const CsvViewer = {
  async render(bytes: Uint8Array) {
    return new TextDecoder().decode(bytes);
  }
};
