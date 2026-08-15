import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

/**
 * Loads the preserved legacy Apps Script files into a shared VM context.
 *
 * This is the TypeScript counterpart of `legacy/tests/helpers/loadGas.js`, and
 * it works the same way for the same reason: Apps Script merges every file
 * into ONE global namespace, so `TaskLogic.gs` can reference the `ENUMS`
 * global from `Enums.gs`. Plain `import`/`require` would give each file its
 * own module scope and the composite files would fail.
 *
 * Loading the real legacy code — rather than re-typing its expected outputs —
 * is what makes these parity tests differential. A port is compared against
 * the actual behaviour of the system being replaced, not against my reading
 * of it.
 */

const LEGACY_ROOT = join(process.cwd(), "legacy");

export type LegacyContext = Record<string, unknown>;

export function loadLegacyContext(relativePaths: string[]): LegacyContext {
  const sandbox: Record<string, unknown> = {};
  const context = createContext(sandbox);

  for (const relativePath of relativePaths) {
    const fullPath = join(LEGACY_ROOT, relativePath);
    const source = readFileSync(fullPath, "utf8");
    runInContext(source, context, { filename: fullPath });
  }

  return context;
}

/** Typed accessor — legacy globals are untyped by nature. */
export function legacyFn<T extends (...args: never[]) => unknown>(
  context: LegacyContext,
  name: string,
): T {
  const fn = context[name];
  if (typeof fn !== "function") {
    throw new Error(`Legacy function "${name}" was not found in the context.`);
  }
  return fn as T;
}

/** The dependency chains each legacy module needs, mirroring the legacy tests. */
export const LEGACY_MODULES = {
  dateLogic: ["apps-script/utils/DateLogic.gs"],
  idLogic: ["apps-script/utils/IdLogic.gs"],
  healthLogic: ["apps-script/clients/HealthLogic.gs"],
  clientLogic: ["apps-script/clients/ClientLogic.gs"],
  workloadLogic: ["apps-script/tasks/WorkloadLogic.gs"],
  taskLogic: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/tasks/TaskLogic.gs",
  ],
  progressLogic: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/tasks/TaskLogic.gs",
    "apps-script/tasks/ProgressLogic.gs",
  ],
  issueLogic: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/issues/IssueLogic.gs",
  ],
  requestLogic: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/requests/ClientRequestLogic.gs",
  ],
  templateLogic: ["apps-script/templates/TemplateExpansionLogic.gs"],
  controlCenter: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/tasks/TaskLogic.gs",
    "apps-script/issues/IssueLogic.gs",
    "apps-script/webapp/ControlCenterViewModelLogic.gs",
  ],
  clientsViewModel: [
    "apps-script/config/Enums.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/tasks/TaskLogic.gs",
    "apps-script/tasks/ProgressLogic.gs",
    "apps-script/issues/IssueLogic.gs",
    "apps-script/requests/ClientRequestLogic.gs",
    "apps-script/webapp/ControlCenterViewModelLogic.gs",
    "apps-script/webapp/ClientsViewModelLogic.gs",
  ],
  managementReport: [
    "apps-script/config/Enums.gs",
    "apps-script/config/Constants.gs",
    "apps-script/utils/DateLogic.gs",
    "apps-script/tasks/TaskLogic.gs",
    "apps-script/tasks/ProgressLogic.gs",
    "apps-script/issues/IssueLogic.gs",
    "apps-script/requests/ClientRequestLogic.gs",
    "apps-script/dashboards/ManagementReportLogic.gs",
  ],
  taskTemplateCatalog: ["apps-script/templates/TaskTemplatesData.gs"],
} as const;
