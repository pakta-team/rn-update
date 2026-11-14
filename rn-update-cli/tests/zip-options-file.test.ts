import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zipOptionsForPayloadFile } from '../src/utils/zip-options';

describe('zipOptionsForPayloadFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-options-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns compress=false for a real PNG file (magic bytes)', () => {
    const pngFile = path.join(tmpDir, 'image.png');
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);
    fs.writeFileSync(pngFile, pngMagic);
    const result = zipOptionsForPayloadFile(pngFile);
    expect(result).toEqual({ compress: false });
  });

  test('returns compress=true with compressionLevel:6 for a JS file', () => {
    const jsFile = path.join(tmpDir, 'bundle.js');
    fs.writeFileSync(jsFile, 'console.log("hello world");\n');
    const result = zipOptionsForPayloadFile(jsFile);
    expect(result).toEqual({ compress: true, compressionLevel: 6 });
  });

  test('returns compress=true for Hermes bytecode magic bytes', () => {
    const hermesFile = path.join(tmpDir, 'index.bundlejs');
    // Hermes bytecode magic: c6 1f bc 03 c1 03 19 1f
    const hermesMagic = Buffer.from([
      0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
    fs.writeFileSync(hermesFile, hermesMagic);
    const result = zipOptionsForPayloadFile(hermesFile);
    expect(result).toEqual({ compress: true, compressionLevel: 6 });
  });

  test('returns compress=false for a JPEG file (magic bytes)', () => {
    const jpegFile = path.join(tmpDir, 'photo.jpg');
    // JPEG magic: FF D8 FF
    const jpegMagic = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01,
    ]);
    fs.writeFileSync(jpegFile, jpegMagic);
    const result = zipOptionsForPayloadFile(jpegFile);
    expect(result).toEqual({ compress: false });
  });

  test('returns compress=true for unknown content with .txt extension', () => {
    const txtFile = path.join(tmpDir, 'readme.txt');
    fs.writeFileSync(txtFile, 'This is a plain text file with some content.\n');
    const result = zipOptionsForPayloadFile(txtFile);
    expect(result).toEqual({ compress: true, compressionLevel: 6 });
  });

  test('handles empty file (no magic bytes, unknown extension)', () => {
    const emptyFile = path.join(tmpDir, 'empty.dat');
    fs.writeFileSync(emptyFile, Buffer.alloc(0));
    const result = zipOptionsForPayloadFile(emptyFile);
    // Empty file: no magic bytes detected, .dat is not in the compressed set,
    // so it falls through to compress=true with level 6
    expect(result).toEqual({ compress: true, compressionLevel: 6 });
  });

  test('respects custom entryName for extension-based detection', () => {
    const dataFile = path.join(tmpDir, 'asset');
    // Write some random non-magic content
    fs.writeFileSync(dataFile, Buffer.from([0x01, 0x02, 0x03, 0x04]));
    // Provide an entryName with a compressed extension
    const result = zipOptionsForPayloadFile(dataFile, 'icon.png');
    expect(result).toEqual({ compress: false });
  });

  test('uses filePath extension when no entryName is given', () => {
    const mp4File = path.join(tmpDir, 'video.mp4');
    fs.writeFileSync(mp4File, Buffer.from([0x00, 0x00, 0x00, 0x1c]));
    const result = zipOptionsForPayloadFile(mp4File);
    expect(result).toEqual({ compress: false });
  });
});
