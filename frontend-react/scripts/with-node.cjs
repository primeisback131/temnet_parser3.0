#!/usr/bin/env node
/*
 * Runs an npm script with a Node.js that is new enough for Vite (18+).
 *
 * The Node on PATH is often an old one kept for other projects. Rather than
 * demanding a global `nvm use`, this looks for a newer Node installed by
 * nvm-windows (or nvm on Unix) and puts it first on PATH for the child
 * process only. Written for the oldest Node that may be on PATH, so no modern
 * syntax here.
 *
 *   node scripts/with-node.cjs run dev      -> npm run dev under Node 18+
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var spawn = require("child_process").spawn;

var MIN_MAJOR = 18;

function major(version) {
  var m = /^v?(\d+)/.exec(version);
  return m ? parseInt(m[1], 10) : 0;
}

/** Directories where version managers keep their Node installs. */
function candidateRoots() {
  var roots = [];
  if (process.env.NVM_HOME) roots.push(process.env.NVM_HOME);
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, "nvm"));
  if (process.env.NVM_DIR) roots.push(path.join(process.env.NVM_DIR, "versions", "node"));
  roots.push(path.join(os.homedir(), ".nvm", "versions", "node"));
  return roots;
}

/** The newest Node >= MIN_MAJOR found under the version-manager roots, or null. */
function findNewerNode() {
  var best = null;
  candidateRoots().forEach(function (root) {
    var entries;
    try {
      entries = fs.readdirSync(root);
    } catch (e) {
      return;
    }
    entries.forEach(function (name) {
      var m = major(name);
      if (m < MIN_MAJOR) return;
      var dir = path.join(root, name);
      var bin = process.platform === "win32" ? dir : path.join(dir, "bin");
      var exe = path.join(bin, process.platform === "win32" ? "node.exe" : "node");
      if (!fs.existsSync(exe)) return;
      if (!best || m > best.major) best = { major: m, bin: bin, name: name };
    });
  });
  return best;
}

var args = process.argv.slice(2);
var env = Object.assign({}, process.env);

if (major(process.versions.node) < MIN_MAJOR) {
  var newer = findNewerNode();
  if (!newer) {
    console.error(
      "Node.js " + MIN_MAJOR + "+ is required (found " + process.versions.node + ").\n" +
      "Install it, for example with nvm-windows:  nvm install 22\n" +
      "This script then picks it up automatically, no global `nvm use` needed."
    );
    process.exit(1);
  }
  console.log("Using Node " + newer.name + " from " + newer.bin + " (PATH has " + process.versions.node + ")");
  env.PATH = newer.bin + path.delimiter + (env.PATH || env.Path || "");
  env.Path = env.PATH;
}

var npm = process.platform === "win32" ? "npm.cmd" : "npm";
var child = spawn(npm, args, { stdio: "inherit", env: env, shell: process.platform === "win32" });
child.on("exit", function (code) {
  process.exit(code === null ? 1 : code);
});
