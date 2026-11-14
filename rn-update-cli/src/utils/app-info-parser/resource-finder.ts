/**
 * [INPUT]: 依赖 Node Buffer、文件内有界小端 Reader 与 Android resources.arsc 二进制资源表格式，无 bytebuffer 运行时依赖
 * [OUTPUT]: 对外提供 ResourceFinder，按资源标识解析包内字符串和图标引用
 * [POS]: Android 资源解析底座，由 parseApkManifest 解析资源引用时消费，不负责 ZIP 生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Code translated from a C# project https://github.com/hylander0/Iteedee.ApkReader/blob/master/Iteedee.ApkReader/ApkResourceFinder.cs
 *
 * Decode binary file `resources.arsc` from a .apk file to a JavaScript Object.
 */

/**
 * Little-endian cursor over a Buffer: the subset of the `bytebuffer` API this
 * decoder used. Reads past `limit` throw a RangeError, which the chunk loops
 * below rely on to stop at the end of the data.
 */
class Reader {
  offset = 0;
  readonly limit: number;

  constructor(readonly buffer: Buffer) {
    this.limit = buffer.length;
  }

  private advance(size: number) {
    const at = this.offset;
    if (at < 0 || at + size > this.limit) {
      throw new RangeError(
        `Illegal offset: 0 <= ${at} (+${size}) <= ${this.limit}`,
      );
    }
    this.offset = at + size;
    return at;
  }

  remaining() {
    return this.limit - this.offset;
  }

  readByte() {
    return this.buffer.readInt8(this.advance(1));
  }

  readUint8() {
    return this.buffer.readUInt8(this.advance(1));
  }

  readShort() {
    return this.buffer.readInt16LE(this.advance(2));
  }

  readUint16() {
    return this.buffer.readUInt16LE(this.advance(2));
  }

  readInt() {
    return this.buffer.readInt32LE(this.advance(4));
  }

  skip(len: number) {
    this.advance(len);
  }

  /** The next `len` bytes as a new reader (a view, not a copy). */
  readBytes(len: number) {
    const at = this.advance(len);
    return new Reader(this.buffer.subarray(at, at + len));
  }
}

/** The `size`-byte chunk starting at `pos`, cut short at the end of the data. */
function chunkAt(bb: Reader, pos: number, size: number) {
  return new Reader(bb.buffer.subarray(pos, pos + size));
}

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;

const FLAG_COMPLEX = 0x0001;

export class ResourceFinder {
  private valueStringPool: string[] | null = null;

  private packageId = 0;

  private responseMap: Record<string, any[]> = {};

  /** Map of `@<RESOURCE ID>` to the values of that resource. */
  processResourceTable(resourceBuffer: Buffer) {
    const bb = new Reader(resourceBuffer);

    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const packageCount = bb.readInt();

    if (type !== RES_TABLE_TYPE) {
      throw new Error('No RES_TABLE_TYPE found!');
    }
    if (size !== bb.limit) {
      throw new Error(
        'The buffer size not matches to the resource table size.',
      );
    }
    bb.offset = headerSize;

    let realStringPoolCount = 0;
    let realPackageCount = 0;

    while (true) {
      let pos = 0;
      let t = 0;
      let s = 0;
      try {
        pos = bb.offset;
        t = bb.readShort();
        bb.readShort(); // header size
        s = bb.readInt();
      } catch (_e) {
        break;
      }
      if (t === RES_STRING_POOL_TYPE) {
        if (realStringPoolCount === 0) {
          this.valueStringPool = this.processStringPool(chunkAt(bb, pos, s));
        }
        realStringPoolCount++;
      } else if (t === RES_TABLE_PACKAGE_TYPE) {
        this.processPackage(chunkAt(bb, pos, s));
        realPackageCount++;
      } else {
        throw new Error('Unsupported type');
      }
      bb.offset = pos + s;
      if (!bb.remaining()) break;
    }

    if (realStringPoolCount !== 1) {
      throw new Error('More than 1 string pool found!');
    }
    if (realPackageCount !== packageCount) {
      throw new Error('Real package count not equals the declared count.');
    }

    return this.responseMap;
  }

  private processPackage(bb: Reader) {
    bb.readShort(); // type
    const headerSize = bb.readShort();
    bb.readInt(); // size
    this.packageId = bb.readInt();
    bb.skip(256); // package name

    const typeStrings = bb.readInt();
    bb.readInt(); // last public type
    const keyStrings = bb.readInt();
    bb.readInt(); // last public key

    if (typeStrings !== headerSize) {
      throw new Error(
        'TypeStrings must immediately following the package structure header.',
      );
    }

    // the type and key string pools only name entries: skip both, and the
    // type specs (only flags); types carry the values
    bb.offset = keyStrings;
    bb.readShort(); // key pool type
    bb.readShort(); // key pool header size
    bb.offset = keyStrings + bb.readInt();
    while (true) {
      const pos = bb.offset;
      try {
        const t = bb.readShort();
        bb.readShort(); // header size
        const s = bb.readInt();

        if (t === RES_TABLE_TYPE_TYPE) {
          bb.offset = pos;
          this.processType(bb.readBytes(s));
        }

        if (s === 0) {
          break;
        }

        bb.offset = pos + s;

        if (!bb.remaining()) {
          break;
        }
      } catch (_e) {
        break;
      }
    }
  }

  private processType(bb: Reader) {
    bb.readShort(); // type
    const headerSize = bb.readShort();
    bb.readInt(); // size
    const id = bb.readByte();
    bb.skip(3); // res0, res1
    const entryCount = bb.readInt();
    const entriesStart = bb.readInt();

    const refKeys: Record<string, number> = {};

    bb.offset = headerSize;

    if (headerSize + entryCount * 4 !== entriesStart) {
      throw new Error('HeaderSize, entryCount and entriesStart are not valid.');
    }

    const entryIndices = new Array<number>(entryCount);
    for (let i = 0; i < entryCount; ++i) {
      entryIndices[i] = bb.readInt();
    }

    for (let i = 0; i < entryCount; ++i) {
      if (entryIndices[i] === -1) continue;

      const resourceId = (this.packageId << 24) | (id << 16) | i;

      let entryFlag = 0;
      try {
        bb.readShort(); // entry size
        entryFlag = bb.readShort();
        bb.readInt(); // key
      } catch (_e) {
        break;
      }

      if ((entryFlag & FLAG_COMPLEX) === 0) {
        bb.readShort(); // value size
        bb.readUint8(); // res0
        const valueDataType = bb.readUint8();
        const valueData = bb.readInt();

        const idStr = Number(resourceId).toString(16);

        let data: string | null = null;
        if (valueDataType === TYPE_STRING) {
          data = this.valueStringPool ? this.valueStringPool[valueData] : null;
        } else if (valueDataType === TYPE_REFERENCE) {
          refKeys[idStr] = valueData;
        } else {
          data = `${valueData}`;
        }

        this.putIntoMap(`@${idStr}`, data);
      } else {
        bb.readInt(); // parent
        const valueCount = bb.readInt();
        // name (4) + Res_value (8) per value; maps are not resolved
        bb.skip(valueCount * 12);
      }
    }

    for (const refKey in refKeys) {
      const values =
        this.responseMap[
          `@${Number(refKeys[refKey]).toString(16).toUpperCase()}`
        ];
      if (values != null && Object.keys(values).length < 1000) {
        for (const value of values) {
          this.putIntoMap(`@${refKey}`, value);
        }
      }
    }
  }

  private processStringPool(bb: Reader) {
    bb.readShort(); // type
    bb.readShort(); // header size
    bb.readInt(); // size
    const stringCount = bb.readInt();
    bb.readInt(); // style count
    const flags = bb.readInt();
    const stringsStart = bb.readInt();
    bb.readInt(); // styles start

    const isUtf8 = (flags & 256) !== 0;

    const offsets = new Array<number>(stringCount);
    for (let i = 0; i < stringCount; ++i) {
      offsets[i] = bb.readInt();
    }

    const strings = new Array<string>(stringCount);

    for (let i = 0; i < stringCount; ++i) {
      bb.offset = stringsStart + offsets[i];
      strings[i] = '';

      if (isUtf8) {
        // UTF-16 length, then UTF-8 byte length; each 1 or 2 bytes
        if ((bb.readUint8() & 0x80) !== 0) {
          bb.readUint8();
        }
        let u8len = bb.readUint8();
        if ((u8len & 0x80) !== 0) {
          u8len = ((u8len & 0x7f) << 8) + bb.readUint8();
        }
        if (u8len > 0) {
          strings[i] = bb.readBytes(u8len).buffer.toString('utf8');
        }
      } else {
        let u16len = bb.readUint16();
        if ((u16len & 0x8000) !== 0) {
          u16len = ((u16len & 0x7fff) << 16) + bb.readUint16();
        }
        if (u16len > 0) {
          strings[i] = bb.readBytes(u16len * 2).buffer.toString('utf16le');
        }
      }
    }

    return strings;
  }

  private putIntoMap(resId: string, value: any) {
    const key = resId.toUpperCase();
    if (this.responseMap[key] == null) {
      this.responseMap[key] = [];
    }
    if (value) {
      this.responseMap[key].push(value);
    }
  }
}
