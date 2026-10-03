// electron/main/services/zipper.ts
// 将指定目录打包为 ZIP 压缩包（archiver v8：ESM，具名导出 ZipArchive 类）

import * as fs from 'node:fs';
import { ZipArchive } from 'archiver';

/**
 * 把 srcDir 目录下的所有内容打包到 zipPath
 * @param srcDir 要打包的源目录
 * @param zipPath 输出的 ZIP 文件路径
 */
export function zipDirectory(srcDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', (err: Error) => reject(err));
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    // 把目录内容打包到 ZIP 根（不包含外层目录名）
    archive.directory(srcDir, false);
    void archive.finalize();
  });
}
