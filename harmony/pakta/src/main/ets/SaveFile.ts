/**
 * [INPUT]: 依赖 ResourceManager.RawFileDescriptor、Harmony fs 和固定复制缓冲区
 * [OUTPUT]: 对外提供 saveFileToSandbox，分块复制 rawfile 到应用沙箱并保证句柄关闭
 * [POS]: Harmony 资源 IO 原语，被 DownloadTask 复用，不解释资源命名或更新策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import resourceManager from '@ohos.resourceManager';
import fs, { ReadOptions } from '@ohos.file.fs';

const COPY_BUFFER_SIZE = 64 * 1024;

export const saveFileToSandbox = (
  from: resourceManager.RawFileDescriptor,
  toPath: string,
) => {
  let to = fs.openSync(toPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);

  const buffer = new ArrayBuffer(COPY_BUFFER_SIZE);
  let currentOffset = from.offset;
  let remaining = from.length;

  try {
    while (remaining > 0) {
      const readOption: ReadOptions = {
        offset: currentOffset,
        length: Math.min(COPY_BUFFER_SIZE, remaining),
      };
      const readLength = fs.readSync(from.fd, buffer, readOption);
      if (readLength <= 0) {
        throw new Error(`Unexpected EOF while copying resource to ${toPath}`);
      }

      fs.writeSync(to.fd, buffer, { length: readLength });
      currentOffset += readLength;
      remaining -= readLength;
    }
  } finally {
    fs.close(to);
  }
};
