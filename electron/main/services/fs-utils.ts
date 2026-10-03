// electron/main/services/fs-utils.ts
// Windows 下删除文件/目录常因杀软扫描、资源管理器索引、只读属性而瞬时失败
// （EPERM / ENOTEMPTY / EBUSY）。Node 的 fs.rm 默认 maxRetries=0，一次失败即中断，
// 可能留下半删除的目录。这里提供带重试、只读属性兜底、并以「路径确实消失」为
// 成功标准的删除工具，避免 UI 假装成功而磁盘残留。

import * as fs from 'fs';
import * as path from 'path';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

/** 清除只读属性（Windows 下只读文件 unlink 会 EPERM） */
async function clearWritable(target: string, isDir: boolean): Promise<void> {
  try {
    await fs.promises.chmod(target, isDir ? 0o777 : 0o666);
  } catch {
    // 某些文件系统不支持 chmod，忽略
  }
}

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('文件操作失败');
}

/**
 * 自底向上手动删除：先递归处理子项（文件先去只读再 unlink，空目录 rm），
 * 用于 fs.rm 整体递归仍有残留时的兜底。
 */
async function removeTreeManually(root: string): Promise<void> {
  const stat = await fs.promises.lstat(root).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    await clearWritable(root, true);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      // 目录可能已不可访问/已被删除
    }
    for (const entry of entries) {
      await removeTreeManually(path.join(root, entry.name));
    }
    // 非递归 rm 仅能删除空目录
    await fs.promises.rm(root, { force: true }).catch(() => {});
  } else {
    await clearWritable(root, false);
    await fs.promises.unlink(root).catch(() => {});
  }
}

/**
 * 递归删除目录或文件：
 * 1) fs.rm 带 maxRetries（覆盖瞬时 EPERM/ENOTEMPTY），整体再重试 2 轮；
 * 2) 校验路径确实消失；
 * 3) 仍有残留时自底向上手动兜底（覆盖只读属性等 fs.rm 未处理的情况）；
 * 4) 最终仍残留则抛错——调用方必须感知失败，不能当作成功。
 * 目标原本不存在视为成功。
 */
export async function rmRobust(target: string): Promise<void> {
  if (!(await pathExists(target))) return;

  try {
    await withRetries(
      () =>
        fs.promises.rm(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 120
        }),
      2,
      200
    );
  } catch {
    // 继续进入手动兜底
  }

  if (!(await pathExists(target))) return;

  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(150 + attempt * 150);
    await removeTreeManually(target);
    if (!(await pathExists(target))) return;
  }

  throw new Error(`文件可能被占用或无权限，删除未完成：${target}`);
}

/** 删除单个文件（去只读后重试）；目标不存在视为成功，仍存在则抛错 */
export async function rmFileRobust(target: string): Promise<void> {
  if (!(await pathExists(target))) return;
  await withRetries(async () => {
    await clearWritable(target, false);
    await fs.promises.unlink(target);
  }, 5, 120);
  if (await pathExists(target)) {
    throw new Error(`文件可能被占用，删除未完成：${target}`);
  }
}
