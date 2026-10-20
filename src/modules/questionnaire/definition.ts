import type { QuestionnaireDefinition } from "./types";

/**
 * Requirements questionnaire, version 1. The definition lives in code (reviewed, tested, and
 * versioned in Git); every stored response records the version it was answered against.
 *
 * To change the questionnaire: add a NEW version (never edit a published one), register it in
 * QUESTIONNAIRES, and raise LATEST_VERSION. Old responses keep rendering with their own version.
 * Labels for sections, questions and options live in messages/{ar,fr}.json under "Requirements";
 * a unit test fails if any is missing.
 */

export const WORKLOADS = [
  "file_storage",
  "containers",
  "home_automation",
  "virtualization",
  "media",
  "backup_target",
  "surveillance",
  "remote_access_vpn",
  "web_hosting",
  "dev_test",
  "other",
] as const;

export const QUESTIONNAIRE_V1: QuestionnaireDefinition = {
  version: 1,
  sections: [
    {
      id: "usage",
      questions: [
        { id: "workloads", kind: "multi", required: true, options: WORKLOADS },
        {
          id: "workloadsOther",
          kind: "text",
          maxLength: 300,
          showIf: { question: "workloads", includes: "other" },
        },
        { id: "concurrentUsers", kind: "number", required: true, min: 1, max: 1000, integer: true },
        {
          id: "containerCount",
          kind: "number",
          min: 0,
          max: 500,
          integer: true,
          showIf: { question: "workloads", includes: "containers" },
        },
        {
          id: "vmCount",
          kind: "number",
          min: 0,
          max: 100,
          integer: true,
          showIf: { question: "workloads", includes: "virtualization" },
        },
        {
          id: "cameraCount",
          kind: "number",
          required: true,
          min: 1,
          max: 64,
          integer: true,
          showIf: { question: "workloads", includes: "surveillance" },
        },
        {
          id: "homeDeviceCount",
          kind: "number",
          min: 1,
          max: 500,
          integer: true,
          showIf: { question: "workloads", includes: "home_automation" },
        },
      ],
    },
    {
      id: "budget",
      questions: [
        { id: "budgetMinDzd", kind: "number", min: 0, max: 100_000_000 },
        {
          id: "budgetMaxDzd",
          kind: "number",
          required: true,
          min: 0,
          max: 100_000_000,
          atLeast: "budgetMinDzd",
        },
      ],
    },
    {
      id: "performance",
      questions: [
        { id: "ramGb", kind: "single", options: ["8", "16", "32", "64", "128", "256", "unsure"] },
        {
          id: "cpuPriority",
          kind: "single",
          required: true,
          options: ["low_power", "balanced", "performance"],
        },
        {
          id: "gpuNeeded",
          kind: "boolean",
          showIf: { question: "workloads", includesAny: ["media", "surveillance", "dev_test"] },
        },
      ],
    },
    {
      id: "storage",
      questions: [
        { id: "storageTb", kind: "number", required: true, min: 0, max: 1000 },
        {
          id: "redundancy",
          kind: "single",
          options: ["none", "mirror", "raid5", "raid6", "unsure"],
          showIf: { question: "storageTb", gt: 0 },
        },
        {
          id: "storageMedia",
          kind: "single",
          options: ["ssd", "hdd", "mixed", "unsure"],
          showIf: { question: "storageTb", gt: 0 },
        },
      ],
    },
    {
      id: "network",
      questions: [
        { id: "lanSpeed", kind: "single", options: ["1g", "2_5g", "10g", "unsure"] },
        { id: "vlanNeeded", kind: "boolean" },
        { id: "wifiNeeded", kind: "boolean" },
        { id: "networkDevices", kind: "number", min: 1, max: 2000, integer: true },
      ],
    },
    {
      id: "environment",
      questions: [
        { id: "alwaysOn", kind: "boolean", required: true },
        {
          id: "maxPowerWatts",
          kind: "number",
          min: 5,
          max: 5000,
          integer: true,
          showIf: { question: "alwaysOn", equals: true },
        },
        { id: "upsNeeded", kind: "boolean" },
        {
          id: "noiseLevel",
          kind: "single",
          required: true,
          options: ["silent", "quiet", "normal", "loud_ok"],
        },
        {
          id: "installLocation",
          kind: "single",
          options: ["living_room", "office", "server_room", "garage_shop", "other"],
        },
      ],
    },
    {
      id: "remote",
      questions: [
        { id: "needsRemoteAccess", kind: "boolean", required: true },
        {
          id: "remoteMethod",
          kind: "single",
          required: true,
          options: ["tailscale", "wireguard", "other_vpn", "port_forward", "unsure"],
          showIf: { question: "needsRemoteAccess", equals: true },
        },
        {
          id: "publicExposure",
          kind: "boolean",
          showIf: { question: "needsRemoteAccess", equals: true },
        },
      ],
    },
    {
      id: "backup",
      questions: [
        { id: "needsBackup", kind: "boolean", required: true },
        { id: "offsiteBackup", kind: "boolean", showIf: { question: "needsBackup", equals: true } },
        {
          id: "rpoHours",
          kind: "single",
          options: ["1", "24", "168", "unsure"],
          showIf: { question: "needsBackup", equals: true },
        },
      ],
    },
    {
      id: "growth",
      questions: [
        { id: "growth2y", kind: "single", required: true, options: ["none", "some", "high"] },
        { id: "notes", kind: "text", maxLength: 1000 },
      ],
    },
  ],
};

export const QUESTIONNAIRES: Record<number, QuestionnaireDefinition> = {
  1: QUESTIONNAIRE_V1,
};

export const LATEST_VERSION = 1;

export function getDefinition(version: number): QuestionnaireDefinition | undefined {
  return QUESTIONNAIRES[version];
}
