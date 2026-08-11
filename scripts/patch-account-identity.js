#!/usr/bin/env node
/**
 * Recover the selected ChatGPT account from /wham/accounts/check when newer
 * access tokens omit the legacy chatgpt_account_id / chatgpt_plan_type claims.
 *
 * The desktop renderer already loads that endpoint and validates its account
 * ordering. Reusing default_account_id keeps the existing account-mismatch
 * checks intact without confusing the OAuth `poid` organization claim with a
 * ChatGPT account id.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { relPath, SRC_DIR } = require("./patch-util");

const MARKER = "codex-account-identity-fallback-v3";
const DIAGNOSTIC = "account_info_account_id_missing";

function patchSource(source, { fixedByteLength = false } = {}) {
  const diagnosticOffset = source.indexOf(DIAGNOSTIC);
  if (diagnosticOffset < 0) throw new Error(`Unable to find ${DIAGNOSTIC}`);

  let output = source;
  let changed = false;
  const searchEnd = Math.min(source.length, diagnosticOffset + 12_000);
  const section = source.slice(diagnosticOffset, searchEnd);
  const fallbackPattern =
    /[A-Za-z_$][\w$]*\.accountId\?\?[A-Za-z_$][\w$]*\?\.accountId\?\?[A-Za-z_$][\w$]*\.data\?\.default_account_id,[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.data\?\.accounts/;
  if (!fallbackPattern.test(section)) {
    const identityPattern =
      /([A-Za-z_$][\w$]*\.accountId\?\?[A-Za-z_$][\w$]*\?\.accountId)\?\?null,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.data\?\.accounts/;
    const match = identityPattern.exec(section);
    if (!match) throw new Error("Unable to locate the desktop account identity merge");

    const replacement = `${match[1]}??${match[3]}.data?.default_account_id,${match[2]}=${match[3]}.data?.accounts`;
    const absoluteStart = diagnosticOffset + match.index;
    output =
      output.slice(0, absoluteStart) +
      replacement +
      output.slice(absoluteStart + match[0].length);
    changed = true;
  }

  const providerOffset = output.indexOf("function b3c", diagnosticOffset);
  if (providerOffset < 0) throw new Error("Unable to find the desktop auth provider");
  const providerEnd = Math.min(output.length, providerOffset + 8_000);
  const providerSection = output.slice(providerOffset, providerEnd);
  const contextFallbackPattern =
    /let cdxAi=q\([A-Za-z_$][\w$]*\),[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\?[A-Za-z_$][\w$]*\?\.userId\?\?cdxAi\.userId\?\?null:null/;
  if (!contextFallbackPattern.test(providerSection)) {
    const contextPattern =
      /;let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\?([A-Za-z_$][\w$]*)\?\.userId\?\?null:null,([A-Za-z_$][\w$]*)=\2\?\3\?\.accountId\?\?null:null,([A-Za-z_$][\w$]*)=\2\?([A-Za-z_$][\w$]*)\.email\?\?\3\?\.email\?\?null:null,([A-Za-z_$][\w$]*)=\2\?\6\.planAtLogin\?\?\3\?\.plan\?\?null:null,/;
    const match = contextPattern.exec(providerSection);
    if (!match) throw new Error("Unable to locate the desktop auth context identity fields");
    const [, userVar, isChatGptVar, infoVar, accountVar, emailVar, baseAuthVar, planVar] = match;
    const replacement =
      `;let cdxAi=q(uw),${userVar}=${isChatGptVar}?${infoVar}?.userId??cdxAi.userId??null:null,` +
      `${accountVar}=${isChatGptVar}?${infoVar}?.accountId??cdxAi.accountId??null:null,` +
      `${emailVar}=${isChatGptVar}?${baseAuthVar}.email??${infoVar}?.email??null:null,` +
      `${planVar}=${isChatGptVar}?${baseAuthVar}.planAtLogin??${infoVar}?.plan??cdxAi.plan??null:null,`;
    const absoluteStart = providerOffset + match.index;
    output =
      output.slice(0, absoluteStart) +
      replacement +
      output.slice(absoluteStart + match[0].length);
    changed = true;
  }

  const atomUserPattern =
    /\.set\([A-Za-z_$][\w$]*,\{accountId:[A-Za-z_$][\w$]*\?\.id\?\?[A-Za-z_$][\w$]*\?\.accountId\?\?null,userId:[A-Za-z_$][\w$]*\?\.account_user_id\?\?null,accountLoading:/;
  if (!atomUserPattern.test(output.slice(diagnosticOffset, providerOffset))) {
    const atomPattern =
      /(\.set\([A-Za-z_$][\w$]*,\{accountId:([A-Za-z_$][\w$]*)\?\.id\?\?[A-Za-z_$][\w$]*\?\.accountId\?\?null),accountLoading:/;
    const atomSection = output.slice(diagnosticOffset, providerOffset);
    const match = atomPattern.exec(atomSection);
    if (!match) throw new Error("Unable to locate the account access atom update");
    const replacement = `${match[1]},userId:${match[2]}?.account_user_id??null,accountLoading:`;
    const absoluteStart = diagnosticOffset + match.index;
    output =
      output.slice(0, absoluteStart) +
      replacement +
      output.slice(absoluteStart + match[0].length);
    changed = true;
  }

  const accessSection = output.slice(diagnosticOffset, providerOffset);
  const recoveredAccountPattern =
    /\.set\([A-Za-z_$][\w$]*,\{accountId:([A-Za-z_$][\w$]*)\?\.id\?\?([A-Za-z_$][\w$]*)\?\.accountId\?\?null,userId:\1\?\.account_user_id\?\?null/;
  const recoveredAccount = recoveredAccountPattern.exec(accessSection);
  if (!recoveredAccount) throw new Error("Unable to locate the recovered account identity");
  const [, serviceAccountVar, fallbackAccountVar] = recoveredAccount;
  const accessFallbackPattern = new RegExp(
    `\\.set\\([A-Za-z_$][\\w$]*,\\{accountId:${serviceAccountVar}\\?\\.id\\?\\?${fallbackAccountVar}\\?\\.accountId\\?\\?null,accountInfoError:[\\s\\S]{0,300}?,plan:${serviceAccountVar}\\?\\.plan_type\\?\\?${fallbackAccountVar}\\?\\.plan\\?\\?null,`,
  );
  if (!accessFallbackPattern.test(accessSection)) {
    const rawAccessPattern =
      /(\.set\([A-Za-z_$][\w$]*,\{accountId:)([A-Za-z_$][\w$]*)\?\.accountId\?\?null,(accountInfoError:[\s\S]{0,300}?,plan:)\2\?\.plan\?\?null,/;
    const match = rawAccessPattern.exec(accessSection);
    if (!match) throw new Error("Unable to locate the parallel Codex access identity");
    const replacement =
      `${match[1]}${serviceAccountVar}?.id??${fallbackAccountVar}?.accountId??null,${match[3]}` +
      `${serviceAccountVar}?.plan_type??${fallbackAccountVar}?.plan??null,`;
    const absoluteStart = diagnosticOffset + match.index;
    output =
      output.slice(0, absoluteStart) +
      replacement +
      output.slice(absoluteStart + match[0].length);
    changed = true;
  }

  if (!changed) return { changed: false, source };

  if (fixedByteLength) {
    const delta = Buffer.byteLength(output) - Buffer.byteLength(source);
    if (delta <= 0) throw new Error(`Expected a positive patch size delta; received ${delta}`);
    const sourceMapPattern = /\/\/# sourceMappingURL=[^\r\n]*/;
    const sourceMap = sourceMapPattern.exec(output);
    if (!sourceMap || sourceMap[0].length <= delta + 3) {
      throw new Error("Unable to reserve fixed-width space from the source map comment");
    }
    output =
      output.slice(0, sourceMap.index) +
      sourceMap[0].slice(0, -delta) +
      output.slice(sourceMap.index + sourceMap[0].length);
    if (Buffer.byteLength(output) !== Buffer.byteLength(source)) {
      throw new Error("Fixed-width account identity patch changed the asset byte length");
    }
  } else {
    output += `\n/*${MARKER}*/\n`;
  }

  return { changed: true, source: output };
}

function findRendererAsset(assetsDir) {
  const matches = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^app-initial-.*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(DIAGNOSTIC)) matches.push({ file, source });
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one app-initial renderer asset; found ${matches.length}`);
  }
  return matches[0];
}

function patchExtractedPlatform(platform, isCheck) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(assetsDir)) return 0;
  const asset = findRendererAsset(assetsDir);
  const result = patchSource(asset.source);
  if (!result.changed) {
    console.log(`  [ok] ${relPath(asset.file)}: account identity fallback already present`);
    return 0;
  }
  console.log(
    `  [${isCheck ? "?" : "*"}] ${relPath(asset.file)}: recover missing ChatGPT account identity`,
  );
  if (!isCheck) fs.writeFileSync(asset.file, result.source, "utf8");
  return 1;
}

function readArchive(asarPath, writable) {
  const descriptor = fs.openSync(asarPath, writable ? "r+" : "r");
  const prefix = Buffer.alloc(16);
  fs.readSync(descriptor, prefix, 0, prefix.length, 0);
  const headerPayloadSize = prefix.readUInt32LE(4);
  const headerJsonSize = prefix.readUInt32LE(12);
  const headerBuffer = Buffer.alloc(headerJsonSize);
  fs.readSync(descriptor, headerBuffer, 0, headerBuffer.length, 16);
  return {
    descriptor,
    header: JSON.parse(headerBuffer.toString("utf8")),
    headerBuffer,
    payloadOffset: 8 + headerPayloadSize,
  };
}

function findArchiveEntry(root, predicate, currentPath = "") {
  const matches = [];
  for (const [name, entry] of Object.entries(root.files || {})) {
    const entryPath = currentPath ? `${currentPath}/${name}` : name;
    if (entry.files) matches.push(...findArchiveEntry(entry, predicate, entryPath));
    else if (predicate(entryPath, entry)) matches.push({ entryPath, entry });
  }
  return matches;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function updateEntryIntegrity(entry, content) {
  const integrity = entry.integrity;
  if (integrity?.algorithm !== "SHA256") return;
  integrity.hash = sha256(content);
  const blockSize = Number(integrity.blockSize);
  integrity.blocks = [];
  if (content.length === 0) {
    integrity.blocks.push(sha256(content));
  } else {
    for (let offset = 0; offset < content.length; offset += blockSize) {
      integrity.blocks.push(sha256(content.subarray(offset, Math.min(content.length, offset + blockSize))));
    }
  }
}

function buildHeader(header) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const picklePayloadSize = Math.ceil((4 + json.length + 1) / 4) * 4;
  const headerPayloadSize = picklePayloadSize + 4;
  const buffer = Buffer.alloc(8 + headerPayloadSize);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(headerPayloadSize, 4);
  buffer.writeUInt32LE(picklePayloadSize, 8);
  buffer.writeUInt32LE(json.length, 12);
  json.copy(buffer, 16);
  return buffer;
}

function repackArchive(asarPath, archive, targetEntry, originalContent, patchedContent) {
  const stat = fs.fstatSync(archive.descriptor);
  const payload = Buffer.alloc(stat.size - archive.payloadOffset);
  fs.readSync(archive.descriptor, payload, 0, payload.length, archive.payloadOffset);

  const targetOffset = Number(targetEntry.offset);
  const targetEnd = targetOffset + originalContent.length;
  const delta = patchedContent.length - originalContent.length;
  targetEntry.size = patchedContent.length;
  updateEntryIntegrity(targetEntry, patchedContent);

  if (delta !== 0) {
    for (const { entry } of findArchiveEntry(archive.header, (_entryPath, item) => item.offset != null)) {
      if (entry !== targetEntry && Number(entry.offset) >= targetEnd) {
        entry.offset = String(Number(entry.offset) + delta);
      }
    }
  }

  const header = buildHeader(archive.header);
  const output = Buffer.concat([
    header,
    payload.subarray(0, targetOffset),
    patchedContent,
    payload.subarray(targetEnd),
  ]);
  const tempPath = `${asarPath}.account-identity-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, output);
  try {
    fs.copyFileSync(tempPath, asarPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function replaceHeaderHash(headerSource, oldHash, newHash) {
  if (oldHash === newHash) return headerSource;
  const first = headerSource.indexOf(oldHash);
  if (first < 0 || headerSource.indexOf(oldHash, first + oldHash.length) >= 0) {
    throw new Error(`Expected one ASAR integrity hash ${oldHash.slice(0, 12)}`);
  }
  return headerSource.slice(0, first) + newHash + headerSource.slice(first + oldHash.length);
}

function patchPackedAsar(asarPath, isCheck) {
  const archive = readArchive(asarPath, false);
  try {
    const matches = findArchiveEntry(
      archive.header,
      (entryPath) => /^webview\/assets\/app-initial-.*\.js$/.test(entryPath),
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one packed app-initial renderer asset; found ${matches.length}`);
    }
    const { entryPath, entry } = matches[0];
    const content = Buffer.alloc(Number(entry.size));
    const contentOffset = archive.payloadOffset + Number(entry.offset);
    fs.readSync(archive.descriptor, content, 0, content.length, contentOffset);
    const result = patchSource(content.toString("utf8"));
    if (!result.changed) {
      console.log(`  [ok] ${entryPath}: account identity fallback already present`);
      return 0;
    }
    console.log(
      `  [${isCheck ? "?" : "*"}] ${entryPath}: recover missing ChatGPT account identity`,
    );
    if (isCheck) return 1;

    const patched = Buffer.from(result.source, "utf8");
    repackArchive(asarPath, archive, entry, content, patched);
    return 1;
  } finally {
    fs.closeSync(archive.descriptor);
  }
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const asarIndex = args.indexOf("--asar");
  if (asarIndex >= 0) {
    const asarPath = args[asarIndex + 1];
    if (!asarPath || !fs.existsSync(asarPath)) throw new Error("--asar requires an existing file");
    const count = patchPackedAsar(path.resolve(asarPath), isCheck);
    console.log(`  [ok] ${isCheck ? "would apply" : "applied"} ${count} account identity edit`);
    return;
  }

  const requested = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = requested
    ? [requested]
    : ["mac-arm64", "mac-x64", "win"].filter((platform) =>
        fs.existsSync(path.join(SRC_DIR, platform, "_asar", "webview", "assets")),
      );
  let count = 0;
  for (const platform of platforms) count += patchExtractedPlatform(platform, isCheck);
  console.log(`  [ok] ${isCheck ? "would apply" : "applied"} ${count} account identity edit`);
}

main();
