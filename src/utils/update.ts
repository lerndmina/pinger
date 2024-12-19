import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { getVersion } from "../index";
import fs from "fs/promises";
import AdmZip from "adm-zip";
import { execSync } from "child_process";

async function gitPull(): Promise<void> {
  try {
    execSync("git fetch origin");
    execSync("git reset --hard origin/main");
  } catch (error) {
    // @ts-expect-error
    if (error.message.includes("not a git repository")) {
      console.log("Not a git repository, cloning fresh...");
      execSync("git clone https://github.com/lerndmina/pinger.git temp");

      // Use cross-platform file operations
      await copyRecursive(join(process.cwd(), "temp"), process.cwd());
      await removeRecursive(join(process.cwd(), "temp"));
    } else {
      throw new Error(`Git operation failed: ${error}`);
    }
  }
}

export async function update(options?: Record<string, any>): Promise<void> {
  try {
    console.log("Checking for updates...");
    const version = await getVersion();

    if (version.isUpToDate) {
      console.log("Already up to date!");
      return;
    }

    // Create backup
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

    console.log("Updating code...");
    await gitPull();

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

// Helper functions for recursive operations
async function copyRecursive(src: string, dest: string) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    entry.isDirectory() ? await copyRecursive(srcPath, destPath) : await fs.copyFile(srcPath, destPath);
  }
}

async function removeRecursive(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    entry.isDirectory() ? await removeRecursive(path) : await fs.unlink(path);
  }
  await fs.rmdir(dir);
}
