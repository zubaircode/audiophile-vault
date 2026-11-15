import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * afterPack hook for electron-builder.
 * Previously signed nested CLI binaries in Contents/Resources/bin;
 * retained as a no-op hook if custom nested binaries are added later.
 */
export default async function signNestedBinaries(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  let appPath = context.appOutDir.endsWith('.app')
    ? context.appOutDir
    : path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    try {
      const entries = fs.readdirSync(context.appOutDir);
      const foundApp = entries.find((e) => e.endsWith('.app'));
      if (foundApp) {
        appPath = path.join(context.appOutDir, foundApp);
      }
    } catch {}
  }

  const binDir = path.join(appPath, 'Contents', 'Resources', 'bin');
  const filesToSign = [];
  if (!fs.existsSync(binDir) || filesToSign.length === 0) {
    return;
  }

  for (const file of filesToSign) {
    const fullPath = path.join(binDir, file);
    if (!fs.existsSync(fullPath)) continue;

    const signArgs = ['--force'];
    if (isDevIdSigning && identity !== '-') {
      signArgs.push(
        '--options', 'runtime',
        '--timestamp',
        '--sign', identity
      );
    } else {
      signArgs.push('--sign', '-');
    }

    if (fs.existsSync(entitlementsPath)) {
      signArgs.push('--entitlements', entitlementsPath);
    }

    signArgs.push(fullPath);

    try {
      execFileSync('/usr/bin/codesign', signArgs, { stdio: 'inherit' });
      console.log(`[AFTER-PACK] Successfully signed ${file}`);
    } catch (err) {
      console.warn(`[AFTER-PACK WARNING] Failed to sign ${file}: ${err.message}`);
    }
  }
}
