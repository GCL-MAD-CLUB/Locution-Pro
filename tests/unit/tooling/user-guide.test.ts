import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import type { ExecFileException } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

interface GuideFixture {
  home: string;
  check: () => Promise<{ stdout: string; stderr: string }>;
}

type CommandFailure = ExecFileException & { stderr: string };

async function fixture(t: TestContext, applicationVersion: string): Promise<GuideFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "locution-user-guide-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert(path.basename(root).startsWith("locution-user-guide-"));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "docs/user-guide/.vitepress"), { recursive: true });
  const checker = path.join(root, "scripts/check-user-guide.ts");
  await copyFile(new URL("../../../scripts/check-user-guide.ts", import.meta.url), checker);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: applicationVersion }));
  await writeFile(path.join(root, "README.md"), "# Product\n");
  await writeFile(path.join(root, "docs/user-guide/.vitepress/config.ts"), '({ link: "/" })');
  const home = path.join(root, "docs/user-guide/index.md");
  await writeFile(home, "---\nlayout: home\n---\n用户指南 0.4.2\n");
  return { home, check: () => run(process.execPath, [checker]) };
}

test("prereleases can retain the stable user guide baseline while stable releases enforce it", async (t) => {
  for (const version of ["0.4.2", "0.4.3-preview", "0.5.0-rc.1"]) {
    const { check } = await fixture(t, version);
    assert.match((await check()).stdout, /用户指南检查通过/u);
  }
  const { check } = await fixture(t, "0.4.3");
  await assert.rejects(check(), (error: unknown) => {
    assert(error instanceof Error);
    const failure = error as CommandFailure;
    assert.match(failure.stderr, /用户指南应统一到 0\.4\.3 基线/u);
    return true;
  });
});

test("prereleases still enforce guide content and navigation checks", async (t) => {
  const { home, check } = await fixture(t, "0.4.3-preview");
  await writeFile(
    home,
    "---\nlayout: home\n---\n用户指南 0.4.2\n前端 API\n![截图](/missing.png)\n",
  );
  await assert.rejects(check(), (error: unknown) => {
    assert(error instanceof Error);
    const failure = error as CommandFailure;
    assert.match(failure.stderr, /包含开发说明/u);
    assert.match(failure.stderr, /包含内部技术标识/u);
    assert.match(failure.stderr, /图片不存在/u);
    return true;
  });
});
