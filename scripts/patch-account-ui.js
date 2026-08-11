#!/usr/bin/env node
/**
 * Remove plan-upgrade promotion surfaces without changing account entitlements.
 *
 * The patch keeps usage meters, reset dates, workspace actions, and server-reported
 * limits intact. It only neutralizes personal-plan upsell copy and hides personal
 * upgrade/purchase CTAs. A server-provided "Reset usage" action remains available.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { relPath, SRC_DIR } = require("./patch-util");

const MARKER = "codex-neutral-plan-prompts";
const RATE_MENU_MARKER = `${MARKER}-menu`;
const USAGE_BANNER_MARKER = `${MARKER}-banner`;

function getStaticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  return getStaticString(node);
}

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item?.type) walk(item, visitor, node);
      }
    } else if (child?.type) {
      walk(child, visitor, node);
    }
  }
}

function findAsset(platform, needles, marker = null) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(assetsDir)) return null;

  const matches = [];
  const marked = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(assetsDir, name);
    const source = fs.readFileSync(file, "utf8");
    if (needles.every((needle) => source.includes(needle))) matches.push({ file, source });
    if (marker != null && source.includes(marker)) marked.push({ file, source });
  }
  if (matches.length === 0 && marked.length === 1) return marked[0];
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${platform} asset containing ${needles.join(", ")}; found ${matches.length}`,
    );
  }
  return matches[0];
}

function findSwitchFunction(ast, requiredCases, source = null, requiredSource = null) {
  const required = new Set(requiredCases);
  const matches = [];
  walk(ast, (node) => {
    if (node.type !== "FunctionDeclaration" && node.type !== "FunctionExpression") return;
    let matchingSwitch = null;
    walk(node.body, (child) => {
      if (child.type !== "SwitchStatement") return;
      const labels = new Set(child.cases.map((entry) => getStaticString(entry.test)).filter(Boolean));
      if ([...required].every((label) => labels.has(label))) matchingSwitch = child;
    });
    if (
      matchingSwitch &&
      (requiredSource == null || source?.slice(node.start, node.end).includes(requiredSource))
    ) {
      matches.push({ fn: node, switchNode: matchingSwitch });
    }
  });
  if (matches.length !== 1) {
    throw new Error(`Expected one plan switch; found ${matches.length}`);
  }
  return matches[0];
}

function firstReturn(statements) {
  let result = null;
  for (const statement of statements) {
    walk(statement, (node) => {
      if (result == null && node.type === "ReturnStatement") result = node;
    });
    if (result) break;
  }
  return result;
}

function collectCaseReturnPatches(switchNode, labels, replacement) {
  const targets = new Set(labels);
  const patches = [];
  let pendingTarget = false;

  for (const entry of switchNode.cases) {
    const label = getStaticString(entry.test);
    pendingTarget ||= targets.has(label);
    const returnStatement = firstReturn(entry.consequent);
    if (!returnStatement) continue;
    if (pendingTarget && returnStatement.argument) {
      patches.push({
        start: returnStatement.argument.start,
        end: returnStatement.argument.end,
        replacement,
      });
    }
    pendingTarget = false;
  }
  return patches;
}

function collectCaseConsequentPatches(switchNode, labels, replacement) {
  const targets = new Set(labels);
  const patches = [];
  let pendingTarget = false;

  for (const entry of switchNode.cases) {
    const label = getStaticString(entry.test);
    pendingTarget ||= targets.has(label);
    if (entry.consequent.length === 0) continue;
    if (pendingTarget) {
      patches.push({
        start: entry.consequent[0].start,
        end: entry.consequent[entry.consequent.length - 1].end,
        replacement,
      });
    }
    pendingTarget = false;
  }
  return patches;
}

function applyPatches(source, patches) {
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let result = source;
  for (const patch of ordered) {
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end);
  }
  return result;
}

function patchRateLimitMenu(platform, isCheck) {
  const asset = findAsset(platform, [
    "composer.mode.upgradeToPlus",
    "suppressUpsell",
  ], RATE_MENU_MARKER);
  if (!asset) return 0;
  if (asset.source.includes(RATE_MENU_MARKER)) {
    console.log(`  [ok] ${relPath(asset.file)}: plan prompts already neutralized`);
    return 0;
  }

  const ast = parse(asset.source, { ecmaVersion: "latest", sourceType: "module" });
  const { switchNode } = findSwitchFunction(
    ast,
    ["free", "go", "plus", "prolite"],
    asset.source,
    "composer.mode.upgradeToPlus",
  );
  const patches = collectCaseConsequentPatches(
    switchNode,
    ["free", "go", "plus", "prolite"],
    "return null;",
  );
  if (![1, 3].includes(patches.length)) {
    throw new Error(`Expected one or three personal-plan menu return sites; found ${patches.length}`);
  }

  console.log(`  [${isCheck ? "?" : "*"}] ${relPath(asset.file)}: hide personal upgrade menu items`);
  if (!isCheck) {
    const output = `${applyPatches(asset.source, patches)}\n/*${RATE_MENU_MARKER}*/\n`;
    parse(output, { ecmaVersion: "latest", sourceType: "module" });
    fs.writeFileSync(asset.file, output, "utf8");
  }
  return patches.length;
}

function objectPatternBinding(pattern, propertyName) {
  if (pattern?.type !== "ObjectPattern") return null;
  const property = pattern.properties.find(
    (entry) => entry.type === "Property" && getPropertyName(entry.key) === propertyName,
  );
  return property?.value?.type === "Identifier" ? property.value.name : null;
}

function findObjectPatternBinding(node, propertyName) {
  let binding = null;
  walk(node, (child) => {
    if (binding != null || child.type !== "ObjectPattern") return;
    binding = objectPatternBinding(child, propertyName);
  });
  return binding;
}

function patchUsageBanner(platform, isCheck) {
  const asset = findAsset(platform, [
    "codex.upsellBanner.merged.creditsOrUpgrade.headline",
    "codex.upsellBanner.freeOrGo.headline.noReset",
    "primaryCtaText",
    "shouldDisableCtasUntilBannerClassificationReady",
  ], USAGE_BANNER_MARKER);
  if (!asset) return 0;
  if (asset.source.includes(USAGE_BANNER_MARKER)) {
    console.log(`  [ok] ${relPath(asset.file)}: usage banner already neutralized`);
    return 0;
  }

  const ast = parse(asset.source, { ecmaVersion: "latest", sourceType: "module" });
  const planSwitch = findSwitchFunction(
    ast,
    [
      "plus_rate_limit_reached",
      "prolite_rate_limit_reached",
      "pro_rate_limit_reached",
      "free_trial_rate_limit_reached",
      "go_trial_rate_limit_reached",
      "free_or_go_rate_limit_reached",
    ],
    asset.source,
    "legacyWithReset",
  );
  const hasResetBinding = objectPatternBinding(planSwitch.fn.params[0], "hasResetDate");
  const firstPersonalReturn = firstReturn(
    planSwitch.switchNode.cases
      .filter((entry) =>
        ["plus_rate_limit_reached", "prolite_rate_limit_reached"].includes(
          getStaticString(entry.test),
        ),
      )
      .flatMap((entry) => entry.consequent),
  );
  const firstReturnSource = firstPersonalReturn
    ? asset.source.slice(firstPersonalReturn.argument.start, firstPersonalReturn.argument.end)
    : "";
  const descriptorBinding = firstReturnSource.match(/title:([A-Za-z_$][\w$]*)\.usageTitle/)?.[1];
  if (!hasResetBinding || !descriptorBinding) {
    throw new Error("Unable to identify neutral usage-banner descriptor bindings");
  }
  const neutralReturn = `{title:${descriptorBinding}.usageTitle,message:${hasResetBinding}?${descriptorBinding}.legacyWithReset:${descriptorBinding}.legacy}`;
  const patches = collectCaseReturnPatches(
    planSwitch.switchNode,
    [
      "plus_rate_limit_reached",
      "prolite_rate_limit_reached",
      "pro_rate_limit_reached",
      "free_trial_rate_limit_reached",
      "go_trial_rate_limit_reached",
      "free_or_go_rate_limit_reached",
    ],
    neutralReturn,
  );
  if (patches.length !== 4) {
    throw new Error(`Expected four personal-plan banner return sites; found ${patches.length}`);
  }

  let bannerFunction = null;
  let ctaObject = null;
  walk(ast, (node) => {
    if (node.type !== "FunctionDeclaration" && node.type !== "FunctionExpression") return;
    const fnSource = asset.source.slice(node.start, node.end);
    if (!fnSource.includes("codex.upsellBanner.cta.resetUsage")) return;
    walk(node.body, (child) => {
      if (child.type !== "ObjectExpression") return;
      const names = new Set(child.properties.map((property) => getPropertyName(property.key)));
      if (names.has("primaryCtaText") && names.has("secondaryCtaText") && names.has("customCtas")) {
        bannerFunction = node;
        ctaObject = child;
      }
    });
  });
  if (!bannerFunction || !ctaObject) throw new Error("Unable to locate usage-banner CTA object");

  const workspaceBinding = findObjectPatternBinding(bannerFunction.body, "isWorkspaceAccount");
  const bannerSource = asset.source.slice(bannerFunction.start, bannerFunction.end);
  const resetTextBinding = bannerSource.match(
    /defaultMessage:`Reset usage`[\s\S]{0,240}?let ([A-Za-z_$][\w$]*)=/,
  )?.[1];
  if (!workspaceBinding || !resetTextBinding) {
    throw new Error("Unable to identify usage-banner workspace/reset bindings");
  }

  for (const property of ctaObject.properties) {
    const name = getPropertyName(property.key);
    if (!["primaryCtaText", "secondaryCtaText", "customCtas"].includes(name)) continue;
    const original = asset.source.slice(property.value.start, property.value.end);
    const replacement =
      name === "secondaryCtaText"
        ? `${workspaceBinding}||${original}===${resetTextBinding}?${original}:null`
        : `${workspaceBinding}?${original}:null`;
    patches.push({ start: property.value.start, end: property.value.end, replacement });
  }

  console.log(`  [${isCheck ? "?" : "*"}] ${relPath(asset.file)}: neutralize personal usage upsells`);
  if (!isCheck) {
    const output = `${applyPatches(asset.source, patches)}\n/*${USAGE_BANNER_MARKER}*/\n`;
    parse(output, { ecmaVersion: "latest", sourceType: "module" });
    fs.writeFileSync(asset.file, output, "utf8");
  }
  return patches.length;
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const requested = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = requested
    ? [requested]
    : ["mac-arm64", "mac-x64", "win"].filter((platform) =>
        fs.existsSync(path.join(SRC_DIR, platform, "_asar", "webview", "assets")),
      );

  let count = 0;
  for (const platform of platforms) {
    count += patchRateLimitMenu(platform, isCheck);
    count += patchUsageBanner(platform, isCheck);
  }
  console.log(`  [ok] ${isCheck ? "would apply" : "applied"} ${count} neutral plan-prompt edits`);
}

main();
