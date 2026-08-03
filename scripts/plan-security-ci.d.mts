export type SecurityLanguage = "actions" | "javascript-typescript" | "python";

export function planSecurityLanguages(
  files: string[],
  options?: { forceFull?: boolean },
): SecurityLanguage[];

export function planSecurityAuditScopes(
  files: string[],
  options?: { forceFull?: boolean },
): {
  containers: boolean;
  nodeDependencies: boolean;
  pythonDependencies: boolean;
};
