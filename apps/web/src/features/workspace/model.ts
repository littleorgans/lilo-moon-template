import type { Principal } from "@littleorgans/auth";

export interface VisibleRows {
  readonly accounts: number;
  readonly profiles: number;
}

/** Data for the workspace example. Authentication works without a configured database. */
export interface WorkspaceView {
  readonly principal: Principal;
  readonly rows: VisibleRows | null;
  readonly databaseError: string | null;
}
