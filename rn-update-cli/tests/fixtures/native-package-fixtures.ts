/**
 * [INPUT]: 依赖 Node 文件流、yazl 与 Android 二进制 XML 块格式
 * [OUTPUT]: 提供 writeZip 与 binaryXml，生成真实原生包解析器可消费的隔离测试制品
 * [POS]: CLI 测试夹具层，供包解析与进程入口回归共享；不进入生产包
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import { ZipFile as YazlZipFile } from 'yazl';

export async function writeZip(
  zipPath: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        name,
      );
    }
    zipFile.outputStream.on('error', reject);
    zipFile.outputStream.pipe(fs.createWriteStream(zipPath)).on('close', () => {
      resolve();
    });
    zipFile.end();
  });
}

// Minimal binary (AAPT) XML writer: a UTF-16 string pool plus start/end
// element chunks whose attributes carry typed values.
type Attr = [name: string, type: number, data: number | string];
type Node = { name: string; attrs: Attr[]; children?: Node[] };

export function binaryXml(root: Node): Buffer {
  const strings: string[] = [];
  const ref = (s: string) => {
    if (!strings.includes(s)) strings.push(s);
    return strings.indexOf(s);
  };
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    return b;
  };
  const chunk = (type: number, headerSize: number, body: Buffer[]) => {
    const data = Buffer.concat(body);
    return Buffer.concat([
      u16(type),
      u16(headerSize),
      u32(8 + data.length),
      data,
    ]);
  };
  const elements: Buffer[] = [];
  const walk = (node: Node) => {
    const name = ref(node.name);
    const attrs = node.attrs.map(([attrName, type, data]) =>
      Buffer.concat([
        u32(-1),
        u32(ref(attrName)),
        u32(typeof data === 'string' ? ref(data) : -1),
        u16(8),
        Buffer.from([0, type]),
        u32(typeof data === 'string' ? ref(data) : data),
      ]),
    );
    elements.push(
      chunk(0x0102, 16, [
        u32(1),
        u32(-1),
        u32(-1),
        u32(name),
        u16(20),
        u16(20),
        u16(attrs.length),
        u16(0),
        u16(0),
        u16(0),
        ...attrs,
      ]),
    );
    for (const child of node.children ?? []) walk(child);
    elements.push(chunk(0x0103, 16, [u32(1), u32(-1), u32(-1), u32(name)]));
  };
  walk(root);
  const encoded = strings.map((s) =>
    Buffer.concat([u16(s.length), Buffer.from(s, 'utf16le'), u16(0)]),
  );
  const offsets: Buffer[] = [];
  let at = 0;
  for (const e of encoded) {
    offsets.push(u32(at));
    at += e.length;
  }
  const pool = chunk(0x0001, 28, [
    u32(strings.length),
    u32(0),
    u32(0),
    u32(28 + 4 * strings.length),
    u32(0),
    ...offsets,
    ...encoded,
  ]);
  return chunk(0x0003, 8, [pool, ...elements]);
}
