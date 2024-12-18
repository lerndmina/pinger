import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { getVersion } from "../index";
import fs from "fs/promises";
import AdmZip from "adm-zip";

async function copyRecursive(src: string, dest: string) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function removeRecursive(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeRecursive(path);
    } else {
      await fs.unlink(path);
    }
  }

  await fs.rmdir(dir);
}

export async function update(options?: Record<string, any>): Promise<void> {
  try {
    console.log("Checking for updates...");
    const version = await getVersion();

    if (version.isUpToDate) {
      console.log("Already up to date!");
      return;
    }

    const backupDir = join(process.cwd(), "backups");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `backup_${timestamp}`);

    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    console.log("Creating backup...");
    const zip = new AdmZip();
    zip.addLocalFolder(process.cwd(), "", (path) => {
      return !path.includes("node_modules") && !path.includes(".git") && !path.includes("backups");
    });
    zip.writeZip(join(backupPath + ".zip"));

    console.log("Downloading new version...");
    const response = await fetch(`https://api.github.com/repos/lerndmina/pinger/zipball/${version.upstreamSha}`);
    const buffer = await response.arrayBuffer();

    console.log("Extracting files...");
    const updateZip = new AdmZip(Buffer.from(buffer));
    const tempDir = join(process.cwd(), "temp_update");
    updateZip.extractAllTo(tempDir, true);

    const [updateFolder] = await fs.readdir(tempDir);
    await copyRecursive(join(tempDir, updateFolder), process.cwd());
    await removeRecursive(tempDir);

    console.log(`
Update complete!
Backup saved to: ${backupPath}.zip
Previous version: ${version.localSha.slice(0, 7)}
New version: ${version.upstreamSha.slice(0, 7)}
    `);
  } catch (error) {
    console.error("Update failed:", error);
    throw error;
  }
}
