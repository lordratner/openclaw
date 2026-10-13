import { AsyncLocalStorage } from "node:async_hooks";
import { buildContextEngineRuntimeSettings } from "../../context-engine/runtime-settings.js";
import type { ContextEngineRuntimeSettings } from "../../context-engine/types.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";

type AssemblyTarget = {
  sessionId: string;
  sessionKey?: string;
  provider?: string | null;
  modelId?: string | null;
};

export type ContextEngineAssemblySnapshot = AssemblyTarget & {
  runtimeSettings: ContextEngineRuntimeSettings;
};

type AssemblyAttempt = { active: boolean; snapshot?: ContextEngineAssemblySnapshot };
// Core selection and SDK assembly can load in different runtime chunks. Share the
// scope carrier, never a last-budget value or settings across attempts.
const assemblyAttempt = resolveGlobalSingleton(
  Symbol.for("openclaw.contextEngineAssemblyAttempt"),
  () => new AsyncLocalStorage<AssemblyAttempt>(),
);

/** Each concrete retry owns its assembly facts; rejected and concurrent attempts share none. */
export async function runWithContextEngineAssemblyAttempt<T>(run: () => Promise<T>) {
  const attempt: AssemblyAttempt = { active: true };
  try {
    const result = await assemblyAttempt.run(attempt, run);
    return { result, assembly: attempt.snapshot };
  } finally {
    // Detached plugin work cannot change the accepted attempt after it settles.
    attempt.active = false;
    attempt.snapshot = undefined;
  }
}

export function clearContextEngineAssemblySnapshot(): void {
  const attempt = assemblyAttempt.getStore();
  if (attempt?.active) {
    attempt.snapshot = undefined;
  }
}

export function prepareContextEngineAssemblySnapshot(
  target: AssemblyTarget,
  settings: ContextEngineRuntimeSettings,
): ContextEngineAssemblySnapshot {
  // Project known primitive fields, not a plugin's mutable object or runtime capabilities.
  const runtimeSettings = buildContextEngineRuntimeSettings({
    mode: settings.runtime.mode,
    harnessId: settings.runtime.harnessId,
    runtimeId: settings.runtime.runtimeId,
    requestedModel: settings.model.requested,
    resolvedModel: target.modelId,
    provider: target.provider,
    modelFamily: settings.model.family,
    selectedContextEngineId: settings.contextEngineSelection.selectedId,
    contextEngineSelectionSource: settings.contextEngineSelection.source,
    promptTokenBudget: settings.limits.promptTokenBudget,
    maxOutputTokens: settings.limits.maxOutputTokens,
    fallbackReason: settings.diagnostics.fallbackReason,
    degradedReason: settings.diagnostics.degradedReason,
    contextEngineHost: {
      id: settings.executionHost.id ?? "",
      label: settings.executionHost.label ?? "",
      capabilities: [],
    },
  });
  return { ...target, runtimeSettings };
}

export function recordContextEngineAssemblySnapshot(snapshot: ContextEngineAssemblySnapshot): void {
  const attempt = assemblyAttempt.getStore();
  if (attempt?.active) {
    attempt.snapshot = snapshot;
  }
}

export function readContextEngineAssemblySettings(
  target: AssemblyTarget,
  snapshot: ContextEngineAssemblySnapshot | null | undefined = assemblyAttempt.getStore()?.snapshot,
): ContextEngineRuntimeSettings | undefined {
  if (
    !snapshot ||
    snapshot.sessionId !== target.sessionId ||
    snapshot.sessionKey !== target.sessionKey ||
    snapshot.provider !== target.provider ||
    snapshot.modelId !== target.modelId
  ) {
    return undefined;
  }
  return snapshot.runtimeSettings;
}
