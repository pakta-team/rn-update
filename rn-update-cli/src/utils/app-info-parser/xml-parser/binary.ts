/**
 * [INPUT]: 依赖 Android binary XML chunk、节点/属性编码与 Buffer 读取规则
 * [OUTPUT]: 对外提供 parseBinaryXml 与 XmlElement，将 AndroidManifest 二进制 XML 转成类型化节点树
 * [POS]: Android manifest 解析底座，只产出结构化节点，不决定应用业务字段
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Binary (AAPT) XML reader, trimmed from
// https://github.com/openstf/adbkit-apkreader to the element tree and the
// attribute value types an AndroidManifest.xml needs.

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML = 0x0003;
const CHUNK_XML_START_ELEMENT = 0x0102;
const CHUNK_XML_END_ELEMENT = 0x0103;
const STRING_POOL_UTF8 = 1 << 8;

// android.util.TypedValue
const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

export interface XmlElement {
  name: string;
  /** typed attribute values; references read as `resourceId:0x<id>` */
  attributes: Record<string, unknown>;
  children: XmlElement[];
}

export function parseBinaryXml(buffer: Buffer): XmlElement {
  let cursor = 0;
  const strings: string[] = [];

  const u8 = () => buffer[cursor++];
  const u16 = () => {
    const value = buffer.readUInt16LE(cursor);
    cursor += 2;
    return value;
  };
  const u32 = () => {
    const value = buffer.readUInt32LE(cursor);
    cursor += 4;
    return value;
  };
  const s32 = () => {
    const value = buffer.readInt32LE(cursor);
    cursor += 4;
    return value;
  };

  const readString = (utf8: boolean) => {
    let byteLength: number;
    if (utf8) {
      // character count, then byte count; each 1 or 2 bytes
      if (u8() & 0x80) u8();
      byteLength = u8();
      if (byteLength & 0x80) {
        byteLength = ((byteLength & 0x7f) << 8) + u8();
      }
    } else {
      byteLength = u16();
      if (byteLength & 0x8000) {
        byteLength = ((byteLength & 0x7fff) << 16) + u16();
      }
      byteLength *= 2;
    }
    const start = cursor;
    cursor += byteLength;
    return buffer.toString(utf8 ? 'utf-8' : 'ucs2', start, cursor);
  };

  const readStringPool = (chunkStart: number) => {
    const count = u32();
    u32(); // style count
    const flags = u32();
    const stringsStart = chunkStart + u32();
    u32(); // styles start
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
      offsets.push(u32());
    }
    for (const offset of offsets) {
      cursor = stringsStart + offset;
      strings.push(readString((flags & STRING_POOL_UTF8) !== 0));
    }
  };

  const readTypedValue = (): unknown => {
    const start = cursor;
    const size = u16() || 8;
    u8(); // res0
    const type = u8();
    const data = start + 4;
    cursor = start + size;
    switch (type) {
      case TYPE_INT_DEC:
      case TYPE_INT_HEX:
        return buffer.readInt32LE(data);
      case TYPE_STRING: {
        const ref = buffer.readInt32LE(data);
        return ref > 0 ? strings[ref] : '';
      }
      case TYPE_REFERENCE:
        return `resourceId:0x${buffer.readUInt32LE(data).toString(16)}`;
      case TYPE_INT_BOOLEAN:
        return buffer.readInt32LE(data) !== 0;
      case TYPE_NULL:
        return null;
      default:
        // floats, dimensions, colors...: not needed, keep the raw bits
        return buffer.readUInt32LE(data);
    }
  };

  const readElement = (): XmlElement => {
    u32(); // line
    u32(); // comment
    s32(); // namespace
    const element: XmlElement = {
      name: strings[s32()],
      attributes: Object.create(null),
      children: [],
    };
    u16(); // attribute start
    u16(); // attribute size
    const attributeCount = u16();
    cursor += 6; // id, class and style indexes
    for (let i = 0; i < attributeCount; i++) {
      s32(); // namespace
      const name = strings[s32()];
      s32(); // raw value
      let value = readTypedValue();
      if (name === 'versionName' && typeof value === 'string') {
        // strip UTF-16 null padding only; keep spaces and non-ASCII chars
        // biome-ignore lint/suspicious/noControlCharactersInRegex: removing NUL padding is the point
        value = value.replace(/\u0000/g, '');
      }
      element.attributes[name] = value;
    }
    return element;
  };

  if (u16() !== CHUNK_XML) {
    throw new Error('Invalid XML header');
  }
  cursor = 8; // past the XML chunk header

  let root: XmlElement | undefined;
  const stack: XmlElement[] = [];
  while (cursor < buffer.length) {
    const start = cursor;
    const type = u16();
    u16(); // header size
    const size = u32();
    if (size < 8) {
      throw new Error(`Invalid chunk size ${size} at offset ${start}`);
    }
    switch (type) {
      case CHUNK_STRING_POOL:
        readStringPool(start);
        break;
      case CHUNK_XML_START_ELEMENT: {
        const element = readElement();
        if (stack.length) {
          stack[stack.length - 1].children.push(element);
        } else {
          root ??= element;
        }
        stack.push(element);
        break;
      }
      case CHUNK_XML_END_ELEMENT:
        stack.pop();
        break;
      // namespaces, resource map, CDATA: not needed
    }
    cursor = start + size;
  }
  if (!root) {
    throw new Error('No root element');
  }
  return root;
}
