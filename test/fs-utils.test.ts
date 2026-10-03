// test/fs-utils.test.ts
// 健壮删除工具：只读文件、深层目录、不存在路径、空目录
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rmRobust, rmFileRobust } from '../electron/main/services/fs-utils';

const roots: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-fsutils-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) {
    const dir = roots.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('rmRobust', () => {
  it('彻底删除含深层文件与只读文件的目录', async () => {
    const root = makeRoot();
    const target = path.join(root, 'tpl');
    fs.mkdirSync(path.join(target, 'assets', 'img'), { recursive: true });
    fs.writeFileSync(path.join(target, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(target, 'assets', 'style.css'), 'body{}');
    fs.writeFileSync(path.join(target, 'assets', 'img', 'a.png'), Buffer.from([1, 2, 3]));
    // 只读文件：Windows 下普通删除会 EPERM
    fs.chmodSync(path.join(target, 'assets', 'img', 'a.png'), 0o444);
    fs.chmodSync(path.join(target, 'assets', 'style.css'), 0o444);

    await rmRobust(target);

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(root)).toBe(true); // 父目录不受影响
  });

  it('目标不存在时视为成功（不抛错）', async () => {
    const root = makeRoot();
    await expect(rmRobust(path.join(root, 'nope'))).resolves.toBeUndefined();
  });

  it('能删除单个文件与空目录', async () => {
    const root = makeRoot();
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'x');
    await rmRobust(file);
    expect(fs.existsSync(file)).toBe(false);

    const emptyDir = path.join(root, 'empty');
    fs.mkdirSync(emptyDir);
    await rmRobust(emptyDir);
    expect(fs.existsSync(emptyDir)).toBe(false);
  });
});

describe('rmFileRobust', () => {
  it('删除只读文件', async () => {
    const root = makeRoot();
    const file = path.join(root, 'ro.txt');
    fs.writeFileSync(file, 'locked');
    fs.chmodSync(file, 0o444);
    await rmFileRobust(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('文件不存在时不抛错', async () => {
    const root = makeRoot();
    await expect(rmFileRobust(path.join(root, 'missing.json'))).resolves.toBeUndefined();
  });
});
