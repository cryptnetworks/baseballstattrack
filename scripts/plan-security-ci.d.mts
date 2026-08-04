export function planSecurityAuditScopes(
  files: string[],
  options?: { forceFull?: boolean },
): {
  containers: boolean;
  nodeDependencies: boolean;
  pythonDependencies: boolean;
  sast: boolean;
};
