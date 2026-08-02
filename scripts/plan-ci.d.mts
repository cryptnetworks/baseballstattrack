export type CiPlan = {
  application: boolean;
  api: boolean;
  containers: boolean;
  database: boolean;
  discord: boolean;
  documentation: boolean;
  operations: boolean;
};

export function planCiScopes(
  files: string[],
  options?: { forceFull?: boolean },
): CiPlan;
