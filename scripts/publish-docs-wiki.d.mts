export interface PublicationPage {
  source: string;
  wiki: string;
  visibility: "public";
  order: number;
}

export interface Publication {
  manifest: Record<string, unknown>;
  pages: PublicationPage[];
  files: Map<string, string | Uint8Array>;
}

export interface PublicationComparison {
  stale: string[];
  changed: string[];
  committed: boolean;
}

export class PublicationError extends Error {}

export function buildPublication(options?: {
  manifestPath?: string;
  sourceRoot?: string;
}): Promise<Publication>;

export function publishPublication(options: {
  publication: Publication;
  wikiRoot: string;
  mode: "dry-run" | "publish";
  sourceSha: string;
  targetBranch?: string;
}): Promise<PublicationComparison>;
