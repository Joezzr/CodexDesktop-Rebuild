const crypto = require("crypto");
const path = require("path");

function repairProjectSidebarState(state, pathModule = path, cryptoModule = crypto, now = Date.now()) {
  const markerKey = "codex-windows-project-sidebar-repair-v1";
  if (state == null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Codex global state must be a JSON object");
  }
  if (state[markerKey]?.completed === true) {
    return { changed: false, createdProjectIds: [], remappedAssignments: 0, state };
  }

  const normalize = (value) =>
    pathModule.win32
      .normalize(String(value))
      .replace(/[\\/]+$/, "")
      .toLocaleLowerCase("en-US");
  const roots = Array.isArray(state["electron-saved-workspace-roots"])
    ? state["electron-saved-workspace-roots"].filter(
        (value) => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const existingProjects =
    state["local-projects"] != null &&
    typeof state["local-projects"] === "object" &&
    !Array.isArray(state["local-projects"])
      ? state["local-projects"]
      : {};
  const projects = { ...existingProjects };
  const rootToProjectId = new Map();

  for (const [projectId, project] of Object.entries(projects)) {
    if (!Array.isArray(project?.rootPaths)) continue;
    for (const root of project.rootPaths) {
      if (typeof root === "string" && root.length > 0) {
        rootToProjectId.set(normalize(root), projectId);
      }
    }
  }

  const createdProjectIds = [];
  for (const root of roots) {
    const normalizedRoot = normalize(root);
    if (rootToProjectId.has(normalizedRoot)) continue;

    let projectId = `local-${cryptoModule.createHash("md5").update(normalizedRoot).digest("hex")}`;
    let suffix = 2;
    while (projects[projectId] != null) {
      projectId = `local-${cryptoModule
        .createHash("md5")
        .update(`${normalizedRoot}:${suffix++}`)
        .digest("hex")}`;
    }

    const timestamp = now + createdProjectIds.length;
    projects[projectId] = {
      id: projectId,
      name: pathModule.win32.basename(root) || root,
      rootPaths: [root],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    rootToProjectId.set(normalizedRoot, projectId);
    createdProjectIds.push(projectId);
  }

  const oldOrder = Array.isArray(state["project-order"]) ? state["project-order"] : [];
  const order = [];
  const seenOrderIds = new Set();
  const appendOrderId = (projectId) => {
    if (typeof projectId !== "string" || projectId.length === 0 || seenOrderIds.has(projectId)) return;
    seenOrderIds.add(projectId);
    order.push(projectId);
  };
  for (const entry of oldOrder) {
    const replacement =
      typeof entry === "string" ? rootToProjectId.get(normalize(entry)) ?? entry : entry;
    appendOrderId(replacement);
  }
  for (const root of roots) appendOrderId(rootToProjectId.get(normalize(root)));
  for (const projectId of Object.keys(projects)) appendOrderId(projectId);

  const assignmentsSource =
    state["thread-project-assignments"] != null &&
    typeof state["thread-project-assignments"] === "object" &&
    !Array.isArray(state["thread-project-assignments"])
      ? state["thread-project-assignments"]
      : {};
  const assignments = { ...assignmentsSource };
  let remappedAssignments = 0;
  for (const [threadId, assignment] of Object.entries(assignments)) {
    if (assignment?.projectKind !== "local" || typeof assignment.projectId !== "string") continue;
    const projectId = rootToProjectId.get(normalize(assignment.projectId));
    if (projectId == null || projectId === assignment.projectId) continue;
    assignments[threadId] = { ...assignment, projectId };
    remappedAssignments++;
  }

  state["local-projects"] = projects;
  state["project-order"] = order;
  if (remappedAssignments > 0) state["thread-project-assignments"] = assignments;
  state[markerKey] = {
    completed: true,
    completedAt: now,
    migratedRootCount: createdProjectIds.length,
    remappedAssignmentCount: remappedAssignments,
  };

  return { changed: true, createdProjectIds, remappedAssignments, state };
}

module.exports = { repairProjectSidebarState };
