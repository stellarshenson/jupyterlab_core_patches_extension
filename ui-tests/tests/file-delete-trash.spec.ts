import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Return the mount that holds `target`: the longest mount point in
 * /proc/self/mountinfo that is a path prefix, as the server patch finds it.
 * The test process and the server share one mount namespace, both in the
 * bubblewrap runner and in CI.
 */
function mountPoint(target: string): string {
  const mounts = fs
    .readFileSync('/proc/self/mountinfo', 'utf-8')
    .split('\n')
    .filter(line => line)
    .map(line =>
      line
        .split(' ')[4]
        .replace(/\\([0-7]{3})/g, (_, octal) =>
          String.fromCharCode(parseInt(octal, 8))
        )
    );
  let best = '/';
  for (const mount of mounts) {
    const inside =
      target === mount || target.startsWith(`${mount.replace(/\/$/, '')}/`);
    if (inside && mount.length >= best.length) {
      best = mount;
    }
  }
  return best;
}

/**
 * Return the real path of `target`, or of its nearest existing parent.
 */
function nearestExisting(target: string): string {
  while (!fs.existsSync(target)) {
    target = path.dirname(target);
  }
  return fs.realpathSync(target);
}

test('a file browser delete moves the file into the trash folder of its mount', async ({
  page,
  tmpPath
}) => {
  const name = `trash-probe-${Date.now()}.txt`;
  await page.contents.uploadContent(
    'trash probe\n',
    'text',
    `${tmpPath}/${name}`
  );
  await page.filebrowser.refresh();
  const item = page.locator('.jp-DirListing-item', { hasText: name });
  await item.waitFor();

  const serverRoot: string = await page.evaluate(
    () =>
      JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
        .serverRoot
  );
  const folder = fs.realpathSync(
    path.join(serverRoot.replace(/^~(?=\/|$)/, os.homedir()), tmpPath)
  );
  const homeTrash = path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    'Trash'
  );
  const folderMount = mountPoint(folder);
  const expected =
    folderMount === mountPoint(nearestExisting(homeTrash))
      ? path.join(homeTrash, 'files', name)
      : path.join(folderMount, `.Trash-${process.getuid!()}`, 'files', name);

  await item.click({ button: 'right' });
  // With delete_to_trash on, JupyterLab labels the delete command "Move to Trash".
  await page
    .locator('.lm-Menu')
    .getByText('Move to Trash', { exact: true })
    .click();
  const confirm = page.locator('.jp-Dialog .jp-mod-warn');
  await expect(confirm).toHaveText('Move to Trash');
  await confirm.click();

  await expect(item).toHaveCount(0);
  await expect.poll(() => fs.existsSync(expected)).toBe(true);
  expect(fs.existsSync(path.join(folder, name))).toBe(false);
});
